"use client";
import Zoom from 'react-medium-image-zoom';
import 'react-medium-image-zoom/dist/styles.css';

export default function ZoomableImage({ src, alt, className, style }) {
  return (
    <Zoom>
      <img 
        src={src} 
        alt={alt || ''} 
        className={className}
        style={style}
      />
    </Zoom>
  );
}
