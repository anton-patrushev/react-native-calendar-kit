import { useCallback, useEffect, useRef } from 'react';
import {
  type GestureResponderEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import type Animated from 'react-native-reanimated';
import {
  type AnimatedRef,
  type ReanimatedEvent,
  scrollTo,
  type SharedValue,
  useEvent,
  useSharedValue,
} from 'react-native-reanimated';

import type {
  EventHandlerInternal,
  LinkedScrollController,
  LinkedScrollGroup,
  ScrollController,
} from './types';

const scrollNativeEventNames = ['onScroll'];

export const useLinkedScrollGroup = (
  providedOffset?: SharedValue<number>
): LinkedScrollGroup => {
  const allControllers = useRef<LinkedScrollController[]>([]);
  const scrollListeners = useRef<
    Map<string, (triggerId: string, offset: { x: number; y: number }) => void>
  >(new Map());
  const internalOffset = useSharedValue(0);
  const offset = useRef<SharedValue<number>>(
    providedOffset ?? internalOffset
  ).current;
  const activeId = useRef<string | null>(null);
  const activeTagRef = useRef<number | null>(null);
  const listenersInitialized = useRef(false);
  const peers = useSharedValue<AnimatedRef<Animated.ScrollView>[]>([]);
  const peersRef = useRef<AnimatedRef<Animated.ScrollView>[]>([]);

  const eventHandler = useEvent<NativeSyntheticEvent<NativeScrollEvent>>(
    (event: ReanimatedEvent<NativeSyntheticEvent<NativeScrollEvent>>) => {
      'worklet';
      offset.value =
        event.contentOffset.x === 0
          ? event.contentOffset.y
          : event.contentOffset.x;

      peers.value.forEach((peer) => {
        scrollTo(peer, event.contentOffset.x, event.contentOffset.y, false);
      });
    },
    scrollNativeEventNames
  ) as unknown as EventHandlerInternal<NativeSyntheticEvent<NativeScrollEvent>>;

  const subscribeToScroll = useCallback(
    (currentTag: number) => {
      const prevTag = activeTagRef.current;
      if (prevTag && prevTag !== currentTag) {
        eventHandler.workletEventHandler.unregisterFromEvents(prevTag);
      }
      eventHandler.workletEventHandler.registerForEvents(currentTag);
      activeTagRef.current = currentTag;
    },
    [eventHandler.workletEventHandler]
  );

  const unsubscribeAll = useCallback(() => {
    allControllers.current.forEach((controller) => {
      if (controller.ref?.getTag) {
        const tag = controller.ref.getTag();
        if (tag) {
          eventHandler.workletEventHandler.unregisterFromEvents(tag);
        }
      }
    });
    activeTagRef.current = null;
  }, [eventHandler.workletEventHandler]);

  useEffect(() => {
    return () => {
      unsubscribeAll();
    };
  }, [unsubscribeAll]);

  const activateController = useCallback(
    (triggerId: string) => {
      const selectedController = allControllers.current.find(
        (controller) => controller.id === triggerId
      );
      const elementTag = selectedController?.ref?.getTag?.() ?? null;

      if (elementTag) {
        activeId.current = triggerId;
        subscribeToScroll(elementTag);
        const peerRefs = allControllers.current
          .filter((controller) => controller.id !== triggerId)
          .map((controller) => controller.ref);
        peersRef.current = peerRefs;
        peers.value = peerRefs;
      }
    },
    [peers, subscribeToScroll]
  );

  const onTouchStartHandler = useCallback(
    (triggerId: string) => {
      activateController(triggerId);
    },
    [activateController]
  );

  const onScrollBeginDragHandler = useCallback(
    (triggerId: string) => {
      activateController(triggerId);
    },
    [activateController]
  );

  const onMomentumScrollBeginHandler = useCallback(
    (triggerId: string) => {
      activateController(triggerId);
    },
    [activateController]
  );

  const initializeListeners = useCallback(() => {
    if (listenersInitialized.current) {
      return;
    }

    scrollListeners.current.set('onTouchStart', onTouchStartHandler);
    scrollListeners.current.set('onScrollBeginDrag', onScrollBeginDragHandler);
    scrollListeners.current.set(
      'onMomentumScrollBegin',
      onMomentumScrollBeginHandler
    );
    listenersInitialized.current = true;
  }, [
    onTouchStartHandler,
    onScrollBeginDragHandler,
    onMomentumScrollBeginHandler,
  ]);

  const addAndGet = useCallback(
    (
      id: string,
      scrollRef: AnimatedRef<Animated.ScrollView>
    ): ScrollController => {
      initializeListeners();

      const existingController = allControllers.current.find(
        (c) => c.id === id
      );
      if (existingController) {
        return existingController.getScrollController();
      }

      const controller = createLinkedScrollController({
        id,
        scrollRef,
        scrollListeners,
      });
      allControllers.current.push(controller);
      return controller.getScrollController();
    },
    [initializeListeners]
  );

  const remove = useCallback(
    (id: string) => {
      const controllerToRemove = allControllers.current.find(
        (controller) => controller.id === id
      );

      if (controllerToRemove?.ref?.getTag) {
        const tag = controllerToRemove.ref.getTag();
        if (activeTagRef.current === tag) {
          activeId.current = null;
          activeTagRef.current = null;
        }
        if (tag) {
          eventHandler.workletEventHandler.unregisterFromEvents(tag);
        }
      }

      allControllers.current = allControllers.current.filter(
        (controller) => controller.id !== id
      );
    },
    [eventHandler.workletEventHandler]
  );

  const setOffset = useCallback(
    (initialOffset: number) => {
      offset.value = initialOffset;
    },
    [offset]
  );

  const getActiveId = useCallback(() => activeId.current, []);

  const setActiveId = useCallback((id: string) => (activeId.current = id), []);

  return { offset, addAndGet, remove, setOffset, getActiveId, setActiveId };
};

type ControllerGroup = {
  id: string;
  scrollRef: AnimatedRef<Animated.ScrollView>;
  scrollListeners: React.RefObject<
    Map<string, (triggerId: string, offset: { x: number; y: number }) => void>
  >;
};

const createLinkedScrollController = ({
  id,
  scrollRef,
  scrollListeners,
}: ControllerGroup) => {
  const onTouchStart = (_event: GestureResponderEvent) => {
    scrollListeners.current?.forEach((listener, key) => {
      if (key === 'onTouchStart') {
        listener(id, { x: 0, y: 0 });
      }
    });
  };

  const onScrollBeginDrag = (
    _event: NativeSyntheticEvent<NativeScrollEvent>
  ) => {
    scrollListeners.current?.forEach((listener, key) => {
      if (key === 'onScrollBeginDrag') {
        listener(id, { x: 0, y: 0 });
      }
    });
  };

  const onMomentumScrollBegin = (
    _event: NativeSyntheticEvent<NativeScrollEvent>
  ) => {
    scrollListeners.current?.forEach((listener, key) => {
      if (key === 'onMomentumScrollBegin') {
        listener(id, { x: 0, y: 0 });
      }
    });
  };

  const instance = {
    id,
    ref: scrollRef,
    getScrollController: () => ({
      onTouchStart,
      onScrollBeginDrag,
      onMomentumScrollBegin,
    }),
  };

  return instance;
};

export default useLinkedScrollGroup;
