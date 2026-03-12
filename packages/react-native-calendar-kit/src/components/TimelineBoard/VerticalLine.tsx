import React from 'react';
import { StyleSheet, View } from 'react-native';

interface DayEndLineStyle {
  borderWidth: number;
  borderStyle: 'solid' | 'dashed' | 'dotted';
  borderColor: string;
}

interface VerticalLineProps {
  borderColor: string;
  index: number;
  columnWidth: number;
  childColumns: number;
  dayEndLineStyle?: DayEndLineStyle;
}

const VerticalLine = ({
  index,
  borderColor,
  columnWidth,
  childColumns,
  dayEndLineStyle,
}: VerticalLineProps) => {
  const eventWidth =
    childColumns > 1 ? columnWidth / childColumns : columnWidth;

  if (dayEndLineStyle) {
    const bw = dayEndLineStyle.borderWidth;
    return (
      <View pointerEvents="box-none" style={[styles.dayEndClip, { width: bw, left: index * eventWidth - bw }]}>
        <View style={[styles.dayEndLine, { borderWidth: bw, borderColor: dayEndLineStyle.borderColor, borderStyle: dayEndLineStyle.borderStyle }]} />
      </View>
    );
  }

  return (
    <View
      pointerEvents="box-none"
      style={[
        styles.verticalLine,
        { backgroundColor: borderColor, left: index * eventWidth },
      ]}
    />
  );
};

export default VerticalLine;

const styles = StyleSheet.create({
  verticalLine: {
    position: 'absolute',
    width: 1,
    backgroundColor: 'grey',
    height: '100%',
  },
  dayEndClip: { position: 'absolute', height: '100%', overflow: 'hidden' },
  dayEndLine: { position: 'absolute', left: 0, width: 0, height: '100%' },
});
