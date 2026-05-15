declare module 'pica' {
  interface PicaOptions {
    quality?: number;
    alpha?: boolean;
    unsharpAmount?: number;
    unsharpRadius?: number;
    unsharpThreshold?: number;
  }

  class Pica {
    resize(from: HTMLCanvasElement, to: HTMLCanvasElement, options?: PicaOptions): Promise<HTMLCanvasElement>;
    toBlob(canvas: HTMLCanvasElement, mimeType?: string, quality?: number): Promise<Blob>;
  }

  export default Pica;
}
