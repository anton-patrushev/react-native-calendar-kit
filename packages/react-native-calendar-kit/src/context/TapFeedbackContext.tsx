import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

export interface TappedSlot {
  startMinutes: number;
  durationMinutes: number;
  dateUnix: number;
  resourceId?: string;
}

interface TapFeedbackContextValue {
  tappedSlot: TappedSlot | null;
  showTapFeedback: (slot: TappedSlot) => void;
  snapInterval: number;
}

const TapFeedbackContext = createContext<TapFeedbackContextValue | null>(null);

interface TapFeedbackProviderProps {
  children: React.ReactNode;
  enabled?: boolean;
  snapInterval?: number;
}

const AUTO_HIDE_DELAY = 500;

export const TapFeedbackProvider: React.FC<TapFeedbackProviderProps> = ({
  children,
  enabled = false,
  snapInterval = 15,
}) => {
  const [tappedSlot, setTappedSlot] = useState<TappedSlot | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showTapFeedback = useCallback(
    (slot: TappedSlot) => {
      if (!enabled) return;

      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      setTappedSlot(slot);

      timeoutRef.current = setTimeout(() => {
        setTappedSlot(null);
        timeoutRef.current = null;
      }, AUTO_HIDE_DELAY);
    },
    [enabled]
  );

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const value = useMemo(
    () => ({
      tappedSlot,
      showTapFeedback,
      snapInterval,
    }),
    [tappedSlot, showTapFeedback, snapInterval]
  );

  return (
    <TapFeedbackContext.Provider value={value}>
      {children}
    </TapFeedbackContext.Provider>
  );
};

export const useTapFeedback = (): TapFeedbackContextValue => {
  const context = useContext(TapFeedbackContext);
  if (!context) {
    return {
      tappedSlot: null,
      showTapFeedback: () => {},
      snapInterval: 15,
    };
  }
  return context;
};
