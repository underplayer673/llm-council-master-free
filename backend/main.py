"""FastAPI backend for LLM Council."""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
import uuid
import json
import asyncio

from . import storage
from .config import CHAIRMAN_MODEL, COUNCIL_MODELS
from .council import (
    calculate_aggregate_rankings,
    generate_conversation_title,
    run_full_council,
    stage1_collect_responses,
    stage2_collect_rankings,
    stage3_synthesize_final,
)

app = FastAPI(title="LLM Council API")

# Enable CORS for cloud/browser clients
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=".*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class CreateConversationRequest(BaseModel):
    """Request to create a new conversation."""
    pass


class SendMessageRequest(BaseModel):
    """Request to send a message in a conversation."""
    content: str
    council_models: Optional[List[str]] = None
    chairman_model: Optional[str] = None
    temperature: Optional[float] = None
    override_chains: Optional[Dict[str, List[str]]] = None
    api_keys: Optional[Dict[str, Optional[str]]] = None
    force_russian: Optional[bool] = False
    system_prompt: Optional[str] = None


def get_message_history(conversation: Dict[str, Any]) -> List[Dict[str, str]]:
    """Convert conversation messages to a simple role/content history for LLMs."""
    history = []
    for msg in conversation.get("messages", []):
        if msg["role"] == "user":
            history.append({"role": "user", "content": msg["content"]})
        elif msg["role"] == "assistant" and "stage3" in msg:
            content = msg["stage3"].get("response", "")
            if content:
                history.append({"role": "assistant", "content": content})
    return history


class ConversationMetadata(BaseModel):
    """Conversation metadata for list view."""
    id: str
    created_at: str
    title: str
    message_count: int


class Conversation(BaseModel):
    """Full conversation with all messages."""
    id: str
    created_at: str
    title: str
    messages: List[Dict[str, Any]]


@app.get("/")
async def root():
    """Health check endpoint."""
    return {"status": "ok", "service": "LLM Council API"}


@app.get("/api/conversations", response_model=List[ConversationMetadata])
async def list_conversations():
    """List all conversations (metadata only)."""
    return storage.list_conversations()


@app.post("/api/conversations", response_model=Conversation)
async def create_conversation(request: CreateConversationRequest):
    """Create a new conversation."""
    conversation_id = str(uuid.uuid4())
    conversation = storage.create_conversation(conversation_id)
    return conversation


@app.get("/api/conversations/{conversation_id}", response_model=Conversation)
async def get_conversation(conversation_id: str):
    """Get a specific conversation with all its messages."""
    conversation = storage.get_conversation(conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return conversation


@app.delete("/api/conversations/{conversation_id}")
async def delete_conversation(conversation_id: str):
    """Delete a conversation."""
    success = storage.delete_conversation(conversation_id)
    if not success:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return {"status": "ok"}


class TitleUpdateModel(BaseModel):
    title: str


@app.post("/api/conversations/{conversation_id}/title")
async def update_title(conversation_id: str, request: TitleUpdateModel):
    """Update conversation title."""
    try:
        storage.update_conversation_title(conversation_id, request.title)
        return {"status": "ok"}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@app.post("/api/conversations/{conversation_id}/message")
async def send_message(conversation_id: str, request: SendMessageRequest):
    """
    Send a message and run the 3-stage council process.
    Returns the complete response with all stages.
    """
    # Check if conversation exists
    conversation = storage.get_conversation(conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")

    # Check if this is the first message
    is_first_message = len(conversation["messages"]) == 0

    # Add user message
    storage.add_user_message(conversation_id, request.content)

    # If this is the first message, generate a title
    if is_first_message:
        title = await generate_conversation_title(request.content, api_keys=request.api_keys)
        storage.update_conversation_title(conversation_id, title)

    # Run the 3-stage council process
    stage1_results, stage2_results, stage3_result, metadata = await run_full_council(
        request.content,
        council_models=request.council_models or COUNCIL_MODELS,
        chairman_model=request.chairman_model or CHAIRMAN_MODEL,
        temperature=request.temperature,
        override_chains=request.override_chains,
        api_keys=request.api_keys,
    )

    # Add assistant message with all stages
    storage.add_assistant_message(
        conversation_id,
        stage1_results,
        stage2_results,
        stage3_result
    )

    # Return the complete response with metadata
    return {
        "stage1": stage1_results,
        "stage2": stage2_results,
        "stage3": stage3_result,
        "metadata": metadata
    }


@app.post("/api/conversations/{conversation_id}/message/stream")
async def send_message_stream(conversation_id: str, request: SendMessageRequest):
    """
    Send a message and stream the 3-stage council process.
    Returns Server-Sent Events as each stage completes.
    """
    # Check if conversation exists
    conversation = storage.get_conversation(conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")

    is_first_message = len(conversation["messages"]) == 0

    async def event_generator():
        try:
            # Get history BEFORE adding new message to pass as context
            history = get_message_history(conversation)
            
            # Apply prefixing if requested for the actual LLM query
            query_content = request.content
            # Use request.system_prompt if provided, otherwise the strict Russian default
            used_prompt = request.system_prompt or "говори и размышляй на русском. Финальный ответ обязан быть на русском языке! ОБЯЗАН."
            
            # Ensure used_prompt has markdown instructions - SOFTENED at user request
            markdown_hint = "\n\nИспользуй Markdown для форматирования. Если уместно, используй таблицы или блоки кода (```язык\nкод\n```). Если не понимаешь вопроса или не можешь на него ответить - честно скажи об этом."
            if "Markdown" not in used_prompt:
                used_prompt += markdown_hint

            if request.force_russian:
                query_content = f"{used_prompt} Мой вопрос: {request.content}"

            # Store ORIGINAL content in DB with metadata
            storage.add_user_message(
                conversation_id, 
                request.content, 
                metadata={
                    "force_russian": request.force_russian,
                    "system_prompt": used_prompt if request.force_russian else None
                }
            )

            # Add placeholder assistant message for persistence
            storage.add_assistant_message(conversation_id)

            # Start title generation in parallel
            title_task = None
            if is_first_message:
                title_task = asyncio.create_task(
                    generate_conversation_title(request.content, api_keys=request.api_keys)
                )

            # Stage 1: Collect responses
            yield f"data: {json.dumps({'type': 'stage1_start'})}\n\n"
            stage1_results = await stage1_collect_responses(
                query_content,
                history=history,
                council_models=request.council_models or COUNCIL_MODELS,
                temperature=request.temperature,
                override_chains=request.override_chains,
                api_keys=request.api_keys,
            )
            
            # Save Stage 1 to DB immediately for persistence on refresh
            storage.update_last_assistant_message(conversation_id, stage1=stage1_results)
            yield f"data: {json.dumps({'type': 'stage1_complete', 'data': stage1_results})}\n\n"

            if not stage1_results:
                yield f"data: {json.dumps({'type': 'error', 'message': 'Все модели не смогли ответить. Проверьте статус API или баланс.'})}\n\n"
                return

            # Stage 2: IMMEDIATELY signal start
            yield f"data: {json.dumps({'type': 'stage2_start'})}\n\n"
            stage2_results, label_to_model = await stage2_collect_rankings(
                query_content, 
                stage1_results,
                history=history,
                council_models=request.council_models or COUNCIL_MODELS,
                temperature=request.temperature,
                override_chains=request.override_chains,
                api_keys=request.api_keys,
            )
            aggregate_rankings = calculate_aggregate_rankings(stage2_results, label_to_model)
            
            # Save Stage 2 to DB
            storage.update_last_assistant_message(
                conversation_id, 
                stage2=stage2_results,
                metadata={'label_to_model': label_to_model, 'aggregate_rankings': aggregate_rankings}
            )
            yield f"data: {json.dumps({'type': 'stage2_complete', 'data': stage2_results, 'metadata': {'label_to_model': label_to_model, 'aggregate_rankings': aggregate_rankings}})}\n\n"

            # Stage 3: IMMEDIATELY signal start
            yield f"data: {json.dumps({'type': 'stage3_start'})}\n\n"
            stage3_result = await stage3_synthesize_final(
                query_content, 
                stage1_results, 
                stage2_results,
                history=history,
                chairman_model=request.chairman_model or CHAIRMAN_MODEL,
                temperature=request.temperature,
                override_chains=request.override_chains,
                api_keys=request.api_keys,
            )
            
            # Save Stage 3 with metadata to DB
            storage.update_last_assistant_message(
                conversation_id,
                stage3=stage3_result
            )
            yield f"data: {json.dumps({'type': 'stage3_complete', 'data': stage3_result})}\n\n"

            # Wait for title generation if it was started
            if title_task:
                try:
                    title = await title_task
                    storage.update_conversation_title(conversation_id, title)
                    yield f"data: {json.dumps({'type': 'title_complete', 'data': {'title': title}})}\n\n"
                except Exception as e:
                    print(f"Title generation error: {e}")

            # Final full update just to be sure
            storage.update_last_assistant_message(
                conversation_id,
                stage1=stage1_results,
                stage2=stage2_results,
                stage3=stage3_result,
                metadata={
                    "label_to_model": label_to_model,
                    "aggregate_rankings": aggregate_rankings
                }
            )

            # Send completion event
            yield f"data: {json.dumps({'type': 'complete'})}\n\n"

        except Exception as e:
            # Send error event
            print(f"Event stream error: {e}")
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        }
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
