/* eslint-disable @typescript-eslint/ban-ts-comment */
import { memo, useEffect } from "react"; // Removed useRef, useCallback
// Import Live2D configuration context
import { useLive2DConfig } from "@/context/live2d-config-context";
// Import IPC handler Hook
import { useIpcHandlers } from "@/hooks/utils/use-ipc-handlers";
// Import Live2D model loading and management Hook
import { useLive2DModel } from "@/hooks/canvas/use-live2d-model";
// Import Live2D model resize Hook
import { useLive2DResize } from "@/hooks/canvas/use-live2d-resize";
// Import interrupt handling Hook
import { useInterrupt } from "@/hooks/utils/use-interrupt";
// Import audio task Hook (now expects props)
import { useAudioTask } from "@/hooks/utils/use-audio-task"; // Assuming useAudioTask is at '@/hooks/utils/use-audio-task'
// Import Hook to force ignore mouse events
import { useForceIgnoreMouse } from "@/hooks/utils/use-force-ignore-mouse";
// Removed Live2DControlContext import

// Define component props interface
interface Live2DProps {
  isPet: boolean; // Whether in pet mode
}

// Live2D component, optimized with memo for performance
export const Live2D = memo(({ isPet }: Live2DProps): JSX.Element => {
  // Get model info and loading status from Live2D config context
  const { modelInfo, isLoading } = useLive2DConfig();
  // Get force ignore mouse event status
  const { forceIgnoreMouse } = useForceIgnoreMouse();

  // Register IPC handlers here as Live2D is a persistent component in the pet mode
  useIpcHandlers({ isPet });

  // Use Live2D model Hook to get references to canvas, app, model, and container
  const { canvasRef, appRef, modelRef, containerRef } = useLive2DModel({
    isPet,
    modelInfo,
  });

  // Use Live2D resize Hook to handle responsive adjustments of model and canvas
  useLive2DResize(containerRef, appRef, modelRef, modelInfo, isPet);

  // useAudioTask is called without props here, as it's not responsible for blink control directly
  // It will be called by WebSocketHandler with the blink control functions
  useAudioTask({ disableAutoBlink: () => {}, enableAutoBlink: () => {} }); // Provide dummy functions here to satisfy type, actual functions will come from WebSocketHandler
  useInterrupt();

  // Effect Hook to expose some Live2D model methods to the window object
  useEffect(() => {
    if (modelRef.current) {
      // @ts-ignore Ignore TypeScript type checking error
      window.live2d = {
        // Get current expression
        expression: (name?: string | number) => modelRef.current?.expression(name),
        // Set specific expression
        setExpression: (name?: string | number) => {
          if (name !== undefined) {
            modelRef.current?.internalModel.motionManager.expressionManager?.setExpression(name);
          }
        },
        // Set random expression
        setRandomExpression: () => modelRef.current?.internalModel.motionManager.expressionManager?.setRandomExpression(),
        // Get names of all expressions
        getExpressions: () => modelRef.current?.internalModel.motionManager.expressionManager?.definitions.map((d) => d.name),
      };
    }
    // Cleanup function, removes window.live2d object when component unmounts
    return () => {
      // @ts-ignore Ignore TypeScript type checking error
      delete window.live2d;
    };
  }, [modelRef.current]); // Dependency on modelRef.current ensures execution after model loads

  // Component render content
  return (
    <div
      ref={containerRef} // Reference for the container div
      style={{
        width: isPet ? "100vw" : "100%", // Set width based on pet mode
        height: isPet ? "100vh" : "100%", // Set height based on pet mode
        pointerEvents: isPet && forceIgnoreMouse ? "none" : "auto", // Set pointer events based on mode and force ignore mouse
        overflow: "hidden", // Hide overflowing content
        opacity: isLoading ? 0 : 1, // Set opacity based on loading status for fade effect
        transition: "opacity 0.3s ease-in-out", // Opacity transition effect
      }}
    >
      <canvas
        id="canvas" // Canvas ID
        ref={canvasRef} // Canvas reference
        style={{
          width: "100%", // Full width of parent container
          height: "100%", // Full height of parent container
          pointerEvents: isPet && forceIgnoreMouse ? "none" : "auto", // Set pointer events based on mode and force ignore mouse
          display: "block", // Prevent extra space below canvas
        }}
      />
    </div>
  );
});

// Set component display name for debugging
Live2D.displayName = "Live2D";

// Export useInterrupt and useAudioTask Hooks
export { useInterrupt, useAudioTask };
