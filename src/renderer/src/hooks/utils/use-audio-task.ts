import { useRef, useEffect } from 'react';
import { useAiState } from '@/context/ai-state-context';
import { useSubtitle } from '@/context/subtitle-context';
import { useChatHistory } from '@/context/chat-history-context';
import { audioTaskQueue } from '@/utils/task-queue';
import { useLive2DModel } from '@/context/live2d-model-context'; // Keep this import
import { toaster } from '@/components/ui/toaster';
import { useWebSocket } from '@/context/websocket-context';
import { DisplayText } from '@/services/websocket-service';

// AudioTaskOptions 接口保持不变
interface AudioTaskOptions {
  audioBase64: string;
  volumes: number[];
  sliceLength: number;
  displayText?: DisplayText | null;
  expressions?: string[] | number[] | null;
  speaker_uid?: string;
  forwarded?: boolean;
}

// 定义 useAudioTask 的 props 接口，用于接收 Live2D 组件传递的函数
interface UseAudioTaskProps {
  disableAutoBlink: () => void;
  enableAutoBlink: () => void;
}

// 接收 disableAutoBlink 和 enableAutoBlink 作为参数
export const useAudioTask = ({ disableAutoBlink, enableAutoBlink }: UseAudioTaskProps) => {
  const { aiState, backendSynthComplete, setBackendSynthComplete } = useAiState();
  const { setSubtitleText } = useSubtitle();
  const { appendResponse, appendAIMessage } = useChatHistory();
  const { currentModel } = useLive2DModel(); // Still need currentModel for speak function
  const { sendMessage } = useWebSocket();

  // 使用 useRef 来存储所有需要持久化的状态和函数
  const stateRef = useRef({
    aiState,
    currentModel,
    setSubtitleText,
    appendResponse,
    appendAIMessage,
    // 将传入的眨眼控制函数也存储在 ref 中，确保在闭包中能访问到最新值
    disableAutoBlink,
    enableAutoBlink,
  });

  // 每次组件渲染时更新 ref 中的值，确保是最新的
  stateRef.current = {
    aiState,
    currentModel,
    setSubtitleText,
    appendResponse,
    appendAIMessage,
    disableAutoBlink,
    enableAutoBlink,
  };

  const handleAudioPlayback = (options: AudioTaskOptions): Promise<void> => new Promise((resolve) => {
    const {
      aiState: currentAiState,
      currentModel: model,
      setSubtitleText: updateSubtitle,
      appendResponse: appendText,
      appendAIMessage: appendAI,
      // 从 stateRef 中解构出眨眼控制函数
      disableAutoBlink: currentDisableAutoBlink,
      enableAutoBlink: currentEnableAutoBlink,
    } = stateRef.current;

    if (currentAiState === 'interrupted') {
      console.error('Audio playback blocked. State:', currentAiState);
      resolve();
      return;
    }

    const { audioBase64, displayText, expressions, forwarded } = options;

    if (displayText) {
      appendText(displayText.text);
      appendAI(displayText.text, displayText.name, displayText.avatar);
      if (audioBase64) {
        updateSubtitle(displayText.text);
      }
      if (!forwarded) {
        sendMessage({
          type: "audio-play-start",
          display_text: displayText,
          forwarded: true,
        });
      }
    }

    if (!model) {
      console.error('Model not initialized');
      resolve();
      return;
    }

    try {
      let isFinished = false;
      if (audioBase64) {
        if (expressions?.[0] !== undefined) {
          currentDisableAutoBlink(); // 禁用眨眼
          model.speak(`data:audio/wav;base64,${audioBase64}`, {
            expression: expressions[0],
            onFinish: () => {
              console.log("Voiceline is over");
              isFinished = true;
              resolve();
              currentEnableAutoBlink(); // 恢复眨眼
            },
            onError: (error) => {
              console.error("Audio playback error:", error);
              isFinished = true;
              resolve();
              currentEnableAutoBlink(); // 恢复眨眼
            },
          });
        } else {
          currentDisableAutoBlink(); // 禁用眨眼
          model.speak(`data:audio/wav;base64,${audioBase64}`, {
            onFinish: () => {
              console.log("Voiceline is over");
              isFinished = true;
              resolve();
              currentEnableAutoBlink(); // 恢复眨眼
            },
            onError: (error) => {
              console.error("Audio playback error:", error);
              isFinished = true;
              resolve();
              currentEnableAutoBlink(); // 恢复眨眼
            },
          });
        }
      } else {
        resolve();
      }

      const checkFinished = () => {
        if (!isFinished) {
          setTimeout(checkFinished, 100);
        }
      };
      checkFinished();
    } catch (error) {
      console.error('Speak function error:', error);
      toaster.create({
        title: `Speak function error: ${error}`,
        type: "error",
        duration: 2000,
      });
      resolve();
    }
  });

  useEffect(() => {
    let isMounted = true;

    const handleComplete = async () => {
      await audioTaskQueue.waitForCompletion();
      if (isMounted && backendSynthComplete) {
        sendMessage({ type: "frontend-playback-complete" });
        setBackendSynthComplete(false);
      }
    };

    handleComplete();

    return () => {
      isMounted = false;
    };
  }, [backendSynthComplete, sendMessage, setBackendSynthComplete]);

  const addAudioTask = async (options: AudioTaskOptions) => {
    const { aiState: currentState } = stateRef.current;

    if (currentState === 'interrupted') {
      console.log('Skipping audio task due to interrupted state');
      return;
    }

    console.log(`Adding audio task ${options.displayText?.text} to queue`);
    audioTaskQueue.addTask(() => handleAudioPlayback(options));
  };

  return {
    addAudioTask,
    appendResponse,
  };
};
