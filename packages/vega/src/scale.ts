import {Dimensions} from 'react-native';

// The UI is designed for a 1920px-wide canvas; scale every size to the real window
// so it fits whatever logical resolution the TV reports.
const DESIGN_WIDTH = 1920;
const window = Dimensions.get('window');

export const windowWidth = window.width;
export const windowHeight = window.height;
export const scale = Math.min(1.25, Math.max(0.35, window.width / DESIGN_WIDTH));

export const px = (n: number): number => Math.round(n * scale);
