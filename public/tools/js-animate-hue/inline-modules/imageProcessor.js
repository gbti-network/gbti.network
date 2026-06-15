// Inline ImageProcessor module for file:// protocol support
window.ImageProcessor = class ImageProcessor {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.originalImageData = null;
    }

    loadImage(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const img = new Image();
                img.onload = () => {
                    this.canvas.width = img.width;
                    this.canvas.height = img.height;
                    this.ctx.drawImage(img, 0, 0);
                    this.originalImageData = this.ctx.getImageData(0, 0, img.width, img.height);
                    resolve({
                        width: img.width,
                        height: img.height,
                        name: file.name,
                        size: file.size
                    });
                };
                img.onerror = reject;
                img.src = e.target.result;
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    processFrame(frameIndex, totalFrames, settings) {
        if (!this.originalImageData) {
            throw new Error('No image loaded');
        }

        // Calculate interpolated values
        const progress = frameIndex / (totalFrames - 1);
        const currentHue = settings.startHue + (settings.endHue - settings.startHue) * progress;
        const currentBrightness = settings.startBrightness + (settings.endBrightness - settings.startBrightness) * progress;
        const currentContrast = settings.startContrast + (settings.endContrast - settings.startContrast) * progress;
        
        // Debug first few frames
        if (frameIndex < 5 || frameIndex === totalFrames - 1) {
            console.log(`Frame ${frameIndex}/${totalFrames}: progress=${progress.toFixed(2)}, brightness=${currentBrightness.toFixed(2)} (${settings.startBrightness} to ${settings.endBrightness})`);
        }

        // Create a copy of the original image data
        const imageData = new ImageData(
            new Uint8ClampedArray(this.originalImageData.data),
            this.originalImageData.width,
            this.originalImageData.height
        );

        // Apply hue shift (unless disabled)
        if (currentHue !== 0 && !settings.hueDisabled) {
            const data = imageData.data;
            for (let i = 0; i < data.length; i += 4) {
                const [r, g, b] = window.ColorUtils.shiftHue(data[i], data[i + 1], data[i + 2], currentHue);
                data[i] = r;
                data[i + 1] = g;
                data[i + 2] = b;
            }
        }

        // Apply brightness (always apply since we use multiplicative brightness)
        this.adjustBrightness(imageData, currentBrightness);

        // Apply contrast
        if (currentContrast !== 0) {
            this.adjustContrast(imageData, currentContrast);
        }

        // Put the processed image data back on the canvas
        this.ctx.putImageData(imageData, 0, 0);

        // Return canvas for further processing
        return this.canvas;
    }

    adjustBrightness(imageData, brightness) {
        return window.ColorUtils.adjustBrightness(imageData, brightness);
    }

    adjustContrast(imageData, contrast) {
        return window.ColorUtils.adjustContrast(imageData, contrast);
    }

    getFrameAsBlob(format = 'image/png', quality = 0.92) {
        return new Promise((resolve) => {
            this.canvas.toBlob(resolve, format, quality);
        });
    }
};