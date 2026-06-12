import React from 'react';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useBody } from '../../context/BodyContext';

interface HorizontalLineProps {
  borderColor: string;
  index: number;
  totalSlots: number;
  renderCustomHorizontalLine?: (props: {
    index: number;
    borderColor: string;
  }) => React.ReactNode;
}

const HorizontalLine = ({
  index,
  borderColor,
  totalSlots,
  renderCustomHorizontalLine,
}: HorizontalLineProps) => {
  const { counterScaleStyle } = useBody();

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        styles.horizontalLine,
        !renderCustomHorizontalLine ? { backgroundColor: borderColor } : {},
        { top: `${(index / totalSlots) * 100}%` },
        counterScaleStyle,
      ]}>
      {renderCustomHorizontalLine?.({ index, borderColor })}
    </Animated.View>
  );
};
export default HorizontalLine;

const styles = StyleSheet.create({
  horizontalLine: {
    position: 'absolute',
    width: '100%',
    height: 1,
  },
});
