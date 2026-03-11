import { useEffect, useRef, useState } from 'react';
import Sidebar from './components/Sidebar';
import ChatInterface from './components/ChatInterface';
import { api } from './api';
import translations from './translations';
import './App.css';

const defaultSettings = {
  theme: 'dark',
  lang: 'ru',
  forceRussian: true,
  autoDetectLang: true,
  systemPrompt:
    'Р“РѕРІРѕСЂРё Рё СЂР°СЃСЃСѓР¶РґР°Р№ РЅР° СЂСѓСЃСЃРєРѕРј. Р¤РёРЅР°Р»СЊРЅС‹Р№ РѕС‚РІРµС‚ РѕР±СЏР·Р°РЅ Р±С‹С‚СЊ РЅР° СЂСѓСЃСЃРєРѕРј СЏР·С‹РєРµ.\n\nРСЃРїРѕР»СЊР·СѓР№ Markdown РґР»СЏ С„РѕСЂРјР°С‚РёСЂРѕРІР°РЅРёСЏ. Р•СЃР»Рё СѓРјРµСЃС‚РЅРѕ, РёСЃРїРѕР»СЊР·СѓР№ С‚Р°Р±Р»РёС†С‹ Рё Р±Р»РѕРєРё РєРѕРґР°. Р•СЃР»Рё РЅРµ РїРѕРЅРёРјР°РµС€СЊ РІРѕРїСЂРѕСЃР°, С‡РµСЃС‚РЅРѕ СЃРєР°Р¶Рё РѕР± СЌС‚РѕРј.',
  chairman: 'Team Elite',
  temperature: 0.7,
  apiKeys: {
    openrouter: '',
    google: '',
    cerebras: '',
  },
  chains: {
    'Team Elite': [
      'google/gemini-2.5-flash',
      'openrouter/stepfun/step-3.5-flash:free',
      'google/gemini-2.5-flash-lite',
    ],
    'Team Pro': [
      'openrouter/arcee-ai/trinity-large-preview:free',
      'google/gemini-2.5-flash-lite',
      'google/gemma-3-27b',
      'openrouter/google/gemma-3-27b:free',
    ],
    'Team Support': [
      'openrouter/nvidia/nemotron-nano-9b-v2:free',
      'cerebras/llama3.1-8b',
      'google/gemma-3-4b',
      'openrouter/google/gemma-3-4b-it:free',
      'openrouter/liquid/lfm-2.5-1.2b-instruct:free',
      'openrouter/openrouter/auto-router',
    ],
  },
};

function mergeSettings(savedSettings) {
  return {
    ...defaultSettings,
    ...savedSettings,
    apiKeys: {
      ...defaultSettings.apiKeys,
      ...(savedSettings?.apiKeys || {}),
    },
    chains: savedSettings?.chains || defaultSettings.chains,
  };
}

function App() {
  const [conversations, setConversations] = useState([]);
  const [currentConversationId, setCurrentConversationId] = useState(null);
  const [currentConversation, setCurrentConversation] = useState(null);
  const [streamingChatIds, setStreamingChatIds] = useState(new Set());
  const activeControllers = useRef({});
  const streamingCache = useRef({});
  const skipNextLoad = useRef(false);

  const [settings, setSettings] = useState(() => {
    const saved = localStorage.getItem('llm-council-settings');
    const defaults = {
      theme: 'dark',
      lang: 'ru',
      forceRussian: true,
      autoDetectLang: true,
      systemPrompt:
        'Говори и рассуждай на русском. Финальный ответ обязан быть на русском языке.\n\nИспользуй Markdown для форматирования. Если уместно, используй таблицы и блоки кода. Если не понимаешь вопроса, честно скажи об этом.',
      chairman: 'Team Elite',
      temperature: 0.7,
      chains: {
        'Team Elite': [
          'google/gemini-2.5-flash',
          'openrouter/stepfun/step-3.5-flash:free',
          'google/gemini-2.5-flash-lite',
        ],
        'Team Pro': [
          'openrouter/arcee-ai/trinity-large-preview:free',
          'google/gemini-2.5-flash-lite',
          'google/gemma-3-27b',
          'openrouter/google/gemma-3-27b:free',
        ],
        'Team Support': [
          'openrouter/nvidia/nemotron-nano-9b-v2:free',
          'cerebras/llama3.1-8b',
          'google/gemma-3-4b',
          'openrouter/google/gemma-3-4b-it:free',
          'openrouter/liquid/lfm-2.5-1.2b-instruct:free',
          'openrouter/openrouter/auto-router',
        ],
      },
    };

    return saved ? mergeSettings(JSON.parse(saved)) : defaultSettings;
  });

  const t = translations[settings.lang] || translations.ru;

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', settings.theme);
    localStorage.setItem('llm-council-settings', JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    loadConversations().then(() => {
      if (!currentConversationId) {
        handleNewConversation();
      }
    });
  }, []);

  useEffect(() => {
    if (currentConversationId && currentConversationId !== 'new') {
      if (skipNextLoad.current) {
        skipNextLoad.current = false;
        return;
      }
      loadConversation(currentConversationId);
    }
  }, [currentConversationId]);

  const loadConversations = async () => {
    try {
      const convs = await api.listConversations();
      setConversations(convs);
      return convs;
    } catch (error) {
      console.error('Failed to load conversations:', error);
      return [];
    }
  };

  const loadConversation = async (id) => {
    if (id === 'new') return;

    try {
      if (streamingCache.current[id]) {
        setCurrentConversation(streamingCache.current[id]);
        return;
      }

      const conv = await api.getConversation(id);
      setCurrentConversation(conv);
    } catch (error) {
      console.error('Failed to load conversation:', error);
    }
  };

  const handleNewConversation = () => {
    setCurrentConversationId('new');
    setCurrentConversation({ id: 'new', messages: [] });
  };

  const handleSelectConversation = (id) => {
    setCurrentConversationId(id);
  };

  const handleDeleteConversation = async (e, id) => {
    e.stopPropagation();

    try {
      await api.deleteConversation(id);
      setConversations((prev) => prev.filter((c) => c.id !== id));

      if (currentConversationId === id) {
        setCurrentConversationId(null);
        setCurrentConversation(null);
      }
    } catch (error) {
      console.error('Failed to delete conversation:', error);
    }
  };

  const handleRenameConversation = async (id, newTitle) => {
    try {
      await api.updateConversationTitle(id, newTitle);
      setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, title: newTitle } : c)));

      if (currentConversationId === id) {
        setCurrentConversation((prev) => (prev ? { ...prev, title: newTitle } : prev));
      }
    } catch (error) {
      console.error('Failed to rename conversation:', error);
    }
  };

  const handleSendMessage = async (content) => {
    if (!content.trim()) return;

    let actualActiveId = currentConversationId;
    const actualSystemPrompt = settings.systemPrompt;
    const actualForceRussian = settings.forceRussian;

    if (actualActiveId === 'new') {
      try {
        const newConv = await api.createConversation();
        const realId = newConv.id;
        const tempTitle = content.substring(0, 30) + (content.length > 30 ? '...' : '');
        newConv.title = tempTitle;

        setCurrentConversationId(realId);
        skipNextLoad.current = true;
        setCurrentConversation(newConv);

        setConversations((prev) => {
          const filtered = prev.filter((c) => c.id !== 'new');
          return [
            {
              id: realId,
              title: tempTitle,
              created_at: new Date().toISOString(),
              message_count: 0,
            },
            ...filtered,
          ];
        });

        actualActiveId = realId;
      } catch (error) {
        console.error('Failed to create conversation on message:', error);
        return;
      }
    }

    if (!actualActiveId) return;

    const streamConversationId = actualActiveId;
    const apiKeys = Object.fromEntries(
      Object.entries(settings.apiKeys || {}).map(([provider, value]) => [provider, value?.trim() || ''])
    );
    setStreamingChatIds((prev) => new Set(prev).add(streamConversationId));

    try {
      const userMessage = {
        role: 'user',
        content,
        metadata: {
          force_russian: actualForceRussian,
          system_prompt: actualForceRussian ? actualSystemPrompt : null,
        },
      };

      setCurrentConversation((prev) => ({
        ...prev,
        messages: [...prev.messages, userMessage],
      }));

      const assistantMessage = {
        role: 'assistant',
        stage1: null,
        stage2: null,
        stage3: null,
        metadata: null,
        loading: {
          stage1: false,
          stage2: false,
          stage3: false,
        },
      };

      const controller = new AbortController();
      activeControllers.current[streamConversationId] = controller;

      setCurrentConversation((prev) => {
        const next = { ...prev, messages: [...prev.messages, assistantMessage] };
        streamingCache.current[streamConversationId] = next;
        return next;
      });

      await api.sendMessageStream(
        streamConversationId,
        content,
        (eventType, event) => {
          const updateState = (prev) => {
            const isCurrent = prev && prev.id === streamConversationId;
            const target = isCurrent ? prev : streamingCache.current[streamConversationId];

            if (!target) return prev;

            const messages = [...target.messages];
            const lastAssistantIndex = [...messages].reverse().findIndex((m) => m.role === 'assistant');
            if (lastAssistantIndex === -1) return prev;

            const actualIndex = messages.length - 1 - lastAssistantIndex;
            const lastMsg = { ...messages[actualIndex] };
            const newLoading = {
              ...(lastMsg.loading || { stage1: false, stage2: false, stage3: false }),
            };
            const newMetadata = { ...(lastMsg.metadata || {}) };
            let newStage1 = lastMsg.stage1;
            let newStage2 = lastMsg.stage2;
            let newStage3 = lastMsg.stage3;
            let newError = lastMsg.error;
            let updatedTitle = target.title;

            switch (eventType) {
              case 'stage1_start':
                newLoading.stage1 = true;
                break;
              case 'stage1_complete':
                newStage1 = event.data;
                newLoading.stage1 = false;
                break;
              case 'stage2_start':
                newLoading.stage2 = true;
                break;
              case 'stage2_complete':
                newStage2 = event.data;
                if (event.metadata) Object.assign(newMetadata, event.metadata);
                newLoading.stage2 = false;
                break;
              case 'stage3_start':
                newLoading.stage3 = true;
                break;
              case 'stage3_complete':
                newStage3 = event.data;
                newLoading.stage3 = false;
                break;
              case 'error':
                newError = event.message;
                newLoading.stage1 = false;
                newLoading.stage2 = false;
                newLoading.stage3 = false;
                break;
              case 'complete':
                newLoading.stage1 = false;
                newLoading.stage2 = false;
                newLoading.stage3 = false;
                break;
              case 'title_complete':
                if (event.data?.title) {
                  updatedTitle = event.data.title;
                  setConversations((list) =>
                    list.map((c) => (c.id === streamConversationId ? { ...c, title: updatedTitle } : c))
                  );
                }
                break;
              default:
                break;
            }

            messages[actualIndex] = {
              ...lastMsg,
              stage1: newStage1,
              stage2: newStage2,
              stage3: newStage3,
              loading: newLoading,
              metadata: newMetadata,
              error: newError,
            };

            const updatedConv = { ...target, title: updatedTitle, messages };
            streamingCache.current[streamConversationId] = updatedConv;
            return isCurrent ? updatedConv : prev;
          };

          setCurrentConversation(updateState);

          if (eventType === 'title_complete' || eventType === 'complete') {
            loadConversations();
          }
        },
        {
          chairman_model: settings.chairman,
          temperature: settings.temperature,
          override_chains: settings.chains,
          council_models: Object.keys(settings.chains),
          api_keys: apiKeys,
          force_russian: settings.forceRussian,
          system_prompt: settings.systemPrompt,
        },
        controller.signal
      );
    } catch (error) {
      if (error.name === 'AbortError') {
        console.log('Stream stopped by user');
      } else {
        console.error('Failed to send message:', error);
      }

      const msgError = error.name === 'AbortError' ? 'Stopped by user' : error.message || 'Connection lost';

      setCurrentConversation((prev) => {
        if (!prev || prev.id !== streamConversationId) return prev;

        const messages = [...prev.messages];
        for (let i = messages.length - 1; i >= 0; i -= 1) {
          if (messages[i].role === 'assistant') {
            messages[i] = {
              ...messages[i],
              error: msgError,
              loading: { stage1: false, stage2: false, stage3: false },
            };
            break;
          }
        }

        const updated = { ...prev, messages };
        streamingCache.current[streamConversationId] = updated;
        return updated;
      });
    } finally {
      delete activeControllers.current[streamConversationId];
      delete streamingCache.current[streamConversationId];
      setStreamingChatIds((prev) => {
        const next = new Set(prev);
        next.delete(streamConversationId);
        return next;
      });
    }
  };

  const handleStopStream = (id) => {
    const cid = id || currentConversationId;
    if (activeControllers.current[cid]) {
      activeControllers.current[cid].abort();
    }
  };

  return (
    <div className="app" data-theme={settings.theme}>
      <Sidebar
        conversations={conversations}
        currentConversationId={currentConversationId}
        onSelectConversation={handleSelectConversation}
        onNewConversation={handleNewConversation}
        onDeleteConversation={handleDeleteConversation}
        onRenameConversation={handleRenameConversation}
        settings={settings}
        setSettings={setSettings}
        t={t}
      />
      <ChatInterface
        conversation={currentConversation}
        onSendMessage={handleSendMessage}
        onStopSendMessage={handleStopStream}
        isLoading={streamingChatIds.has(currentConversationId)}
        t={t}
      />
    </div>
  );
}

export default App;
