import React, { memo, useCallback, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { EXTRA_HEIGHT, HOUR_SHORT_LINE_WIDTH } from '../constants';
import { useBody } from '../context/BodyContext';
import { useTheme } from '../context/ThemeProvider';
import type { ThemeConfigs } from '../types';
import Text from './Text';

const selectTimeColumnTheme = (state: ThemeConfigs) => ({
  cellBorderColor: state.hourBorderColor ?? state.colors.border,
  hourTextColor: state.colors.onBackground,
  hourTextStyle: state.hourTextStyle,
  hourBackgroundColor: state.hourBackgroundColor || state.colors.background,
});

const TimeColumn = () => {
  const {
    hours,
    maxTimelineHeight,
    spaceFromTop,
    spaceFromBottom,
    timelineHeight,
    renderHour,
    renderHalfHour,
    renderQuarterHour,
    hourWidth,
    showTimeColumnRightLine,
    counterScaleStyle,
  } = useBody();
  const { cellBorderColor, hourTextColor, hourTextStyle, hourBackgroundColor } =
    useTheme(selectTimeColumnTheme);

  const fontSize = hourTextStyle?.fontSize ?? 10;
  const style = useMemo(
    () =>
      StyleSheet.flatten([
        styles.hourText,
        { top: -fontSize / 2, color: hourTextColor },
        hourTextStyle,
      ]),
    [fontSize, hourTextColor, hourTextStyle]
  );
  const totalSlots = hours.length;

  const _renderHour = useCallback(
    (hour: { slot: number; time: string }, index: number) => {
      let children: React.ReactNode;
      if (renderHour) {
        children = renderHour({
          hourStr: hour.time,
          minutes: hour.slot,
          style,
        });
      } else {
        children = <Text style={style}>{hour.time}</Text>;
      }

      return (
        <View
          key={hour.slot}
          style={[
            styles.absolute,
            { top: `${(index / totalSlots) * 100}%`, width: '100%' },
          ]}>
          <Animated.View
            style={[
              styles.absolute,
              styles.hour,
              { right: HOUR_SHORT_LINE_WIDTH + 8 },
              counterScaleStyle,
            ]}>
            {children}
          </Animated.View>
          {/* Phase 1 perf: shortLine no longer counter-scaled — 1px tick
              stretching to ~zoomScale px isn't worth a per-tick useAnimatedStyle. */}
          <View
            style={[
              styles.absolute,
              styles.shortLine,
              {
                backgroundColor: cellBorderColor,
                width: HOUR_SHORT_LINE_WIDTH,
              },
            ]}
          />
        </View>
      );
    },
    [cellBorderColor, counterScaleStyle, renderHour, style, totalSlots]
  );

  const halfHourElements = useMemo(() => {
    if (!renderHalfHour) return null;
    return hours.map((hour, index) => {
      const halfMinutes = hour.slot + 30;
      const children = renderHalfHour({
        hourStr: '30',
        minutes: halfMinutes,
        style,
      });
      if (!children) return null;
      return (
        <View
          key={`half-${hour.slot}`}
          style={[
            styles.absolute,
            { top: `${((index + 0.5) / totalSlots) * 100}%`, width: '100%' },
          ]}>
          <Animated.View
            style={[
              styles.absolute,
              styles.hour,
              { right: HOUR_SHORT_LINE_WIDTH + 8 },
              counterScaleStyle,
            ]}>
            {children}
          </Animated.View>
        </View>
      );
    });
  }, [counterScaleStyle, hours, renderHalfHour, style, totalSlots]);

  const quarterHourElements = useMemo(() => {
    if (!renderQuarterHour) return null;
    const elements: React.ReactNode[] = [];
    hours.forEach((hour, index) => {
      // :15 mark
      const q1Minutes = hour.slot + 15;
      const q1Children = renderQuarterHour({
        hourStr: '15',
        minutes: q1Minutes,
        style,
      });
      if (q1Children) {
        elements.push(
          <View
            key={`q1-${hour.slot}`}
            style={[
              styles.absolute,
              { top: `${((index + 0.25) / totalSlots) * 100}%`, width: '100%' },
            ]}>
            <Animated.View
              style={[
                styles.absolute,
                styles.hour,
                { right: HOUR_SHORT_LINE_WIDTH + 8 },
                counterScaleStyle,
              ]}>
              {q1Children}
            </Animated.View>
          </View>
        );
      }
      // :45 mark
      const q3Minutes = hour.slot + 45;
      const q3Children = renderQuarterHour({
        hourStr: '45',
        minutes: q3Minutes,
        style,
      });
      if (q3Children) {
        elements.push(
          <View
            key={`q3-${hour.slot}`}
            style={[
              styles.absolute,
              { top: `${((index + 0.75) / totalSlots) * 100}%`, width: '100%' },
            ]}>
            <Animated.View
              style={[
                styles.absolute,
                styles.hour,
                { right: HOUR_SHORT_LINE_WIDTH + 8 },
                counterScaleStyle,
              ]}>
              {q3Children}
            </Animated.View>
          </View>
        );
      }
    });
    return elements;
  }, [counterScaleStyle, hours, renderQuarterHour, style, totalSlots]);

  const animView = useAnimatedStyle(() => ({
    height: timelineHeight.value - spaceFromTop - spaceFromBottom,
  }));

  return (
    <View
      style={[
        styles.container,
        styles.absolute,
        {
          height: maxTimelineHeight + EXTRA_HEIGHT * 2,
          width: hourWidth,
          backgroundColor: hourBackgroundColor,
        },
      ]}>
      <Animated.View
        style={[
          styles.absolute,
          { width: hourWidth, top: EXTRA_HEIGHT + spaceFromTop },
          animView,
        ]}>
        {hours.map(_renderHour)}
        {quarterHourElements}
        {halfHourElements}
      </Animated.View>
      {showTimeColumnRightLine && (
        <View
          style={[styles.rightLine, { backgroundColor: cellBorderColor }]}
        />
      )}
    </View>
  );
};

export default memo(TimeColumn);

const styles = StyleSheet.create({
  container: { zIndex: 998, elevation: -1 },
  absolute: { position: 'absolute' },
  rightLine: {
    position: 'absolute',
    width: 1,
    right: 0,
    height: '100%',
  },
  hour: { left: 0 },
  shortLine: { height: 1, right: 0 },
  hourText: {
    fontSize: 10,
    textAlign: 'right',
    position: 'absolute',
    left: 0,
    right: 0,
  },
});
