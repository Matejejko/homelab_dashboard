import { useEffect, useRef, useState } from 'react';

// Pixel size of an element, kept current. Charts draw in real pixels so lines
// stay 2 px and dots stay round at any card width.
export function useElementSize() {
  const ref = useRef(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const measure = () => {
      const { width, height } = element.getBoundingClientRect();
      setSize((old) => (
        Math.abs(old.width - width) < 0.5 && Math.abs(old.height - height) < 0.5
          ? old
          : { width, height }
      ));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return [ref, size];
}
