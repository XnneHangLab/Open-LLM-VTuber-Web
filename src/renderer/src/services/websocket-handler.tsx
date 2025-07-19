/* eslint-disable no-sparse-arrays */
/* eslint-disable react-hooks/exhaustive-deps */
// eslint-disable-next-line object-curly-newline
import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { wsService, MessageEvent } from '@/services/websocket-service';
import {
  WebSocketContext, HistoryInfo, defaultWsUrl, defaultBaseUrl,
} from '@/context/websocket-context';
import { ModelInfo, useLive2DConfig } from '@/context/live2d-config-context';
import { useSubtitle } from '@/context/subtitle-context';
import { audioTaskQueue } from '@/utils/task-queue';
// 确保这里导入的是 useAudioTask 的原始定义路径，而不是从 live2d.tsx 重新导出的
import { useAudioTask } from '@/hooks/utils/use-audio-task';
import { useBgUrl } from '@/context/bgurl-context';
import { useConfig } from '@/context/character-config-context';
import { useChatHistory } from '@/context/chat-history-context';
import { toaster } from '@/components/ui/toaster';
import { useVAD } from '@/context/vad-context';
import { AiState, useAiState } from "@/context/ai-state-context";
import { useLocalStorage } from '@/hooks/utils/use-local-storage';
import { useGroup } from '@/context/group-context';
import { useInterrupt } from '@/hooks/utils/use-interrupt';
// 导入 useLive2DModel 来获取 Live2D 模型的实例
import { useLive2DModel } from '@/context/live2d-model-context';


function WebSocketHandler({ children }: { children: React.ReactNode }) {
  const [wsState, setWsState] = useState<string>('CLOSED');
  const [wsUrl, setWsUrl] = useLocalStorage<string>('wsUrl', defaultWsUrl);
  const [baseUrl, setBaseUrl] = useLocalStorage<string>('baseUrl', defaultBaseUrl);
  const { aiState, setAiState, backendSynthComplete, setBackendSynthComplete } = useAiState();
  const { setModelInfo } = useLive2DConfig();
  const { setSubtitleText } = useSubtitle();
  const { clearResponse, setForceNewMessage } = useChatHistory();
  // 获取 Live2D 模型的实例
  const { currentModel } = useLive2DModel();

  // 使用 useRef 来持久化原始的眨眼更新函数
  const originalEyeBlinkUpdateRef = useRef<(() => void) | null>(null);
  // 用于跟踪上一个 Live2D 模型实例，以便在模型切换时重置眨眼函数
  const lastModelRef = useRef<any>(null);

  // 当 currentModel 发生变化时，重置保存的原始眨眼函数
  useEffect(() => {
    // 检查 currentModel 实例是否与上一个模型实例不同
    // 这表示 Live2D 模型可能已被卸载并重新加载（例如，切换角色）
    if (currentModel !== lastModelRef.current) {
      originalEyeBlinkUpdateRef.current = null; // 清除保存的原始眨眼函数
      lastModelRef.current = currentModel; // 更新上一个模型实例为当前模型
      console.log("Live2D 模型实例已更改，重置了原始眨眼更新函数引用。");
    }
  }, [currentModel]); // 依赖 currentModel，当它变化时触发此 effect

  /**
   * @function disableAutoBlink
   * @description 禁用 Live2D 模型的自动眨眼功能。
   * 它会保存原始的眨眼更新函数，然后将其替换为一个空函数。
   * 此函数现在在 WebSocketHandler 中定义，并使用 currentModel。
   */
  const disableAutoBlink = useCallback(() => {
    const model = currentModel; // 使用从 useLive2DModel 获取的 currentModel 
    // @ts-ignore eyeBlink is exist
    if (model && model.internalModel && model.internalModel.eyeBlink) {
      if (!originalEyeBlinkUpdateRef.current) {// @ts-ignore
        originalEyeBlinkUpdateRef.current = model.internalModel.eyeBlink.update;
      }
      // @ts-ignore eyeBlink is exist
      model.internalModel.eyeBlink.update = () => {}; 
      console.log("自动眨眼已禁用。");
    } else {
      // 可以在这里添加更详细的日志，说明模型未初始化或没有 eyeBlink 模块
      console.warn("无法禁用自动眨眼：模型未初始化或没有 eyeBlink 模块。");
    }
  }, [currentModel]); // 依赖 currentModel

  /**
   * @function enableAutoBlink
   * @description 恢复 Live2D 模型的自动眨眼功能。
   * 它会使用之前保存的原始眨眼更新函数来恢复功能。
   * 此函数现在在 WebSocketHandler 中定义，并使用 currentModel。
   */
  const enableAutoBlink = useCallback(() => {
    const model = currentModel; // 使用从 useLive2DModel 获取的 currentModel
    // 只有当模型、eyeBlink 模块和原始函数都存在时才尝试恢复
    // @ts-ignore eyeBlink is exist
    if (model && model.internalModel && model.internalModel.eyeBlink && originalEyeBlinkUpdateRef.current) {
      // @ts-ignore eyeBlink is exist
      model.internalModel.eyeBlink.update = originalEyeBlinkUpdateRef.current;
      console.log("自动眨眼已恢复。");
    } else {
      // 如果条件不满足，打印警告
      console.warn("无法恢复自动眨眼：模型未初始化，没有 eyeBlink 模块或未保存原始函数。");
    }
  }, [currentModel]); // 依赖 currentModel

  // 将 disableAutoBlink 和 enableAutoBlink 传递给 useAudioTask
  const { addAudioTask } = useAudioTask({ disableAutoBlink, enableAutoBlink });

  const bgUrlContext = useBgUrl();
  const { confUid, setConfName, setConfUid, setConfigFiles } = useConfig();
  const [pendingModelInfo, setPendingModelInfo] = useState<ModelInfo | undefined>(undefined);
  const { setSelfUid, setGroupMembers, setIsOwner } = useGroup();
  const { startMic, stopMic, autoStartMicOnConvEnd } = useVAD();
  const autoStartMicOnConvEndRef = useRef(autoStartMicOnConvEnd);
  const { interrupt } = useInterrupt();

  useEffect(() => {
    autoStartMicOnConvEndRef.current = autoStartMicOnConvEnd;
  }, [autoStartMicOnConvEnd]);

  useEffect(() => {
    if (pendingModelInfo) {
      setModelInfo(pendingModelInfo);
      setPendingModelInfo(undefined);
    }
  }, [pendingModelInfo, setModelInfo, confUid]);

  const {
    setCurrentHistoryUid, setMessages, setHistoryList, appendHumanMessage,
  } = useChatHistory();

  const handleControlMessage = useCallback((controlText: string) => {
    switch (controlText) {
      case 'start-mic':
        console.log('Starting microphone...');
        startMic();
        break;
      case 'stop-mic':
        console.log('Stopping microphone...');
        stopMic();
        break;
      case 'conversation-chain-start':
        setAiState('thinking-speaking');
        audioTaskQueue.clearQueue();
        clearResponse();
        break;
      case 'conversation-chain-end':
        audioTaskQueue.addTask(() => new Promise<void>((resolve) => {
          setAiState((currentState: AiState) => {
            if (currentState === 'thinking-speaking') {
              // Auto start mic if enabled
              if (autoStartMicOnConvEndRef.current) {
                startMic();
              }
              return 'idle';
            }
            return currentState;
          });
          resolve();
        }));
        break;
      default:
        console.warn('Unknown control command:', controlText);
    }
  }, [setAiState, clearResponse, setForceNewMessage, startMic, stopMic]);

  const handleWebSocketMessage = useCallback((message: MessageEvent) => {
    console.log('Received message from server:', message);
    switch (message.type) {
      case 'control':
        if (message.text) {
          handleControlMessage(message.text);
        }
        break;
      case 'set-model-and-conf':
        setAiState('loading');
        if (message.conf_name) {
          setConfName(message.conf_name);
        }
        if (message.conf_uid) {
          setConfUid(message.conf_uid);
          console.log('confUid', message.conf_uid);
        }
        if (message.client_uid) {
          setSelfUid(message.client_uid);
        }
        setPendingModelInfo(message.model_info);
        // setModelInfo(message.model_info);
        // We don't know when the confRef in live2d-config-context will be updated, so we set a delay here for convenience
        if (message.model_info && !message.model_info.url.startsWith("http")) {
          const modelUrl = baseUrl + message.model_info.url;
          // eslint-disable-next-line no-param-reassign
          message.model_info.url = modelUrl;
        }

        setAiState('idle');
        break;
      case 'full-text':
        if (message.text) {
          setSubtitleText(message.text);
        }
        break;
      case 'config-files':
        if (message.configs) {
          setConfigFiles(message.configs);
        }
        break;
      case 'config-switched':
        setAiState('idle');
        setSubtitleText('New Character Loaded');

        toaster.create({
          title: 'Character switched',
          type: 'success',
          duration: 2000,
        });

        // setModelInfo(undefined);

        wsService.sendMessage({ type: 'fetch-history-list' });
        wsService.sendMessage({ type: 'create-new-history' });
        break;
      case 'background-files':
        if (message.files) {
          bgUrlContext?.setBackgroundFiles(message.files);
        }
        break;
      case 'audio':
        if (aiState === 'interrupted' || aiState === 'listening') {
          console.log('Audio playback intercepted. Sentence:', message.display_text?.text);
        } else {
          console.log("actions", message.actions);
          addAudioTask({
            audioBase64: message.audio || '',
            volumes: message.volumes || [],
            sliceLength: message.slice_length || 0,
            displayText: message.display_text || null,
            expressions: message.actions?.expressions || null,
            forwarded: message.forwarded || false,
          });
        }
        break;
      case 'history-data':
        if (message.messages) {
          setMessages(message.messages);
        }
        toaster.create({
          title: 'History loaded',
          type: 'success',
          duration: 2000,
        });
        break;
      case 'new-history-created':
        setAiState('idle');
        setSubtitleText('New Conversation Started');
        // No need to open mic here
        if (message.history_uid) {
          setCurrentHistoryUid(message.history_uid);
          setMessages([]);
          const newHistory: HistoryInfo = {
            uid: message.history_uid,
            latest_message: null,
            timestamp: new Date().toISOString(),
          };
          setHistoryList((prev: HistoryInfo[]) => [newHistory, ...prev]);
          toaster.create({
            title: 'New chat history created',
            type: 'success',
            duration: 2000,
          });
        }
        break;
      case 'history-deleted':
        toaster.create({
          title: message.success
            ? 'History deleted successfully'
            : 'Failed to delete history',
          type: message.success ? 'success' : 'error',
          duration: 2000,
        });
        break;
      case 'history-list':
        if (message.histories) {
          setHistoryList(message.histories);
          if (message.histories.length > 0) {
            setCurrentHistoryUid(message.histories[0].uid);
          }
        }
        break;
      case 'user-input-transcription':
        console.log('user-input-transcription: ', message.text);
        if (message.text) {
          appendHumanMessage(message.text);
        }
        break;
      case 'error':
        toaster.create({
          title: message.message,
          type: 'error',
          duration: 2000,
        });
        break;
      case 'group-update':
        console.log('Received group-update:', message.members);
        if (message.members) {
          setGroupMembers(message.members);
        }
        if (message.is_owner !== undefined) {
          setIsOwner(message.is_owner);
        }
        break;
      case 'group-operation-result':
        toaster.create({
          title: message.message,
          type: message.success ? 'success' : 'error',
          duration: 2000,
        });
        break;
      case 'backend-synth-complete':
        setBackendSynthComplete(true);
        break;
      case 'conversation-chain-end':
        if (!audioTaskQueue.hasTask()) {
          setAiState((currentState: AiState) => {
            if (currentState === 'thinking-speaking') {
              return 'idle';
            }
            return currentState;
          });
        }
        break;
      case 'force-new-message':
        setForceNewMessage(true);
        break;
      case 'interrupt-signal':
        // Handle forwarded interrupt
        interrupt(false); // do not send interrupt signal to server
        break;
      default:
        console.warn('Unknown message type:', message.type);
    }
  }, [aiState, addAudioTask, appendHumanMessage, baseUrl, bgUrlContext, setAiState, setConfName, setConfUid, setConfigFiles, setCurrentHistoryUid, setHistoryList, setMessages, setModelInfo, setSubtitleText, startMic, stopMic, setSelfUid, setGroupMembers, setIsOwner, backendSynthComplete, setBackendSynthComplete, clearResponse]);

  useEffect(() => {
    wsService.connect(wsUrl);
  }, [wsUrl]);

  useEffect(() => {
    const stateSubscription = wsService.onStateChange(setWsState);
    const messageSubscription = wsService.onMessage(handleWebSocketMessage);
    return () => {
      stateSubscription.unsubscribe();
      messageSubscription.unsubscribe();
    };
  }, [wsUrl, handleWebSocketMessage]);

  const webSocketContextValue = useMemo(() => ({
    sendMessage: wsService.sendMessage.bind(wsService),
    wsState,
    reconnect: () => wsService.connect(wsUrl),
    wsUrl,
    setWsUrl,
    baseUrl,
    setBaseUrl,
  }), [wsState, wsUrl, baseUrl]);

  return (
    <WebSocketContext.Provider value={webSocketContextValue}>
      {children}
    </WebSocketContext.Provider>
  );
}

export default WebSocketHandler;
