// Inline Animator module for file:// protocol support
window.Animator = class Animator {
    constructor(imageProcessor, onProgress) {
        this.imageProcessor = imageProcessor;
        this.onProgress = onProgress || (() => {});
        this.frames = [];
    }

    async generateFrames(settings) {
        this.frames = [];
        const { frameCount, loopAnimation = false } = settings;

        // Generate forward frames
        for (let i = 0; i < frameCount; i++) {
            this.imageProcessor.processFrame(i, frameCount, settings);
            const blob = await this.imageProcessor.getFrameAsBlob('image/png');
            this.frames.push(blob);
            this.onProgress(i + 1, frameCount);
            await new Promise(resolve => setTimeout(resolve, 0));
        }

        // Generate reverse frames for seamless loop (excluding first and last to avoid duplicates)
        if (loopAnimation && frameCount > 2) {
            for (let i = frameCount - 2; i > 0; i--) {
                // Process frame in reverse
                this.imageProcessor.processFrame(i, frameCount, settings);
                
                // Get frame as blob
                const blob = await this.imageProcessor.getFrameAsBlob('image/png');
                this.frames.push(blob);

                // Report progress for reverse frames
                const reverseProgress = frameCount + (frameCount - 1 - i);
                const totalFrames = loopAnimation ? frameCount * 2 - 2 : frameCount;
                this.onProgress(reverseProgress, totalFrames);

                // Allow UI to update
                await new Promise(resolve => setTimeout(resolve, 0));
            }
        }

        return this.frames;
    }

    async createGIF(settings = {}) {
        let {
            width = this.imageProcessor.canvas.width,
            height = this.imageProcessor.canvas.height,
            quality = 10,
            animationSpeed = 60
        } = settings;

        // Convert FPS to milliseconds delay
        const frameDelay = Math.round(1000 / animationSpeed);

        console.log(`Creating GIF: ${width}x${height}, ${this.frames.length} frames`);

        try {
            // Try gifenc first (better for file:// protocol)
            if (typeof window !== 'undefined' && window.gifenc && window.gifenc.GIFEncoder) {
                console.log('✅ Using gifenc library (optimal)');
                this.updateProgressText('Generating GIF with gifenc encoder...');
                return await this.createGIFWithGifenc(width, height, frameDelay);
            }
            
            // Fallback to gif.js if gifenc not available
            if (window.GIF) {
                console.warn('⚠️ Fallback: Using gif.js library (gifenc not available)');
                this.updateProgressText('Generating GIF with gif.js fallback...');
                return await this.createGIFWithGifJs(width, height, quality, frameDelay);
            }
            
            console.error('❌ No GIF library available');
            throw new Error('No GIF encoding library available');
            
        } catch (error) {
            console.error('GIF creation failed:', error);
            throw error;
        }
    }

    async createGIFWithGifenc(width, height, frameDelay = 33) {
        const { GIFEncoder, quantize, applyPalette, prequantize } = window.gifenc;
        
        console.log('Using gifenc encoder...');
        
        // Create encoder
        const encoder = GIFEncoder();
        
        // Create temporary canvas for processing
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        
        // Use middle frame for palette generation to avoid black frames
        // This ensures we get a good color palette even if animation starts/ends in black
        const paletteFrameIndex = Math.floor(this.frames.length / 2);
        console.log(`Generating palette from frame ${paletteFrameIndex} (middle frame)...`);
        const paletteImg = await this.loadImage(this.frames[paletteFrameIndex]);
        ctx.drawImage(paletteImg, 0, 0, width, height);
        const paletteFrameData = ctx.getImageData(0, 0, width, height);
        
        // Pre-quantize to reduce noise
        prequantize(paletteFrameData.data, { roundRGB: 5, roundAlpha: 10 });
        
        // Generate palette from middle frame
        const palette = quantize(paletteFrameData.data, 128);
        console.log(`Generated palette with ${palette.length} colors from frame ${paletteFrameIndex}`);
        
        // Process each frame with the optimized palette
        for (let i = 0; i < this.frames.length; i++) {
            const img = await this.loadImage(this.frames[i]);
            ctx.drawImage(img, 0, 0, width, height);
            const imageData = ctx.getImageData(0, 0, width, height);
            
            // Pre-quantize for consistency
            prequantize(imageData.data, { roundRGB: 5, roundAlpha: 10 });
            
            // Convert to indexed color using global palette
            const indexed = applyPalette(imageData.data, palette, 'rgb565'); // Use higher quality format
            
            // Add frame to encoder
            encoder.writeFrame(indexed, width, height, {
                palette: i === 0 ? palette : null, // Only first frame needs palette
                delay: frameDelay, // User-defined speed
                repeat: 0, // Infinite loop
                colorDepth: 7 // Higher color depth for better quality
            });
            
            console.log(`Encoded frame ${i + 1}/${this.frames.length}`);
            
            // Update progress for encoding phase
            this.onProgress(i + 1, this.frames.length, 'encoding', 'gif');
        }
        
        // Finish encoding
        encoder.finish();
        
        // Update progress to show finalizing
        this.onProgress(this.frames.length, this.frames.length, 'finalizing', 'gif');
        
        // Get GIF bytes
        const gifBytes = encoder.bytes();
        const blob = new Blob([gifBytes], { type: 'image/gif' });
        
        console.log(`GIF created with gifenc: ${blob.size} bytes`);
        return blob;
    }

    async createGIFWithGifJs(width, height, quality, frameDelay = 33) {
        console.log('Using gif.js fallback...');
        
        return new Promise(async (resolve, reject) => {
            try {
                const isFileProtocol = window.location.protocol === 'file:';
                
                const gif = new GIF({
                    workers: isFileProtocol ? 0 : 2,
                    quality: isFileProtocol ? 20 : quality,
                    width: width,
                    height: height,
                    workerScript: isFileProtocol ? undefined : './lib/gif.worker.js'
                });

                gif.on('finished', resolve);
                gif.on('error', reject);
                gif.on('progress', (p) => {
                    console.log(`GIF.js progress: ${Math.round(p * 100)}%`);
                });

                // Load and add frames
                for (let i = 0; i < this.frames.length; i++) {
                    const img = await this.loadImage(this.frames[i]);
                    gif.addFrame(img, { delay: frameDelay });
                }

                gif.render();
            } catch (error) {
                reject(error);
            }
        });
    }

    // Helper method to load image from blob
    loadImage(blob) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = URL.createObjectURL(blob);
        });
    }

    async createWebM(settings = {}) {
        let {
            width = this.imageProcessor.canvas.width,
            height = this.imageProcessor.canvas.height,
            animationSpeed = 30, // Matched FPS for consistency
            quality = 'medium'
        } = settings;

        console.log(`Creating WebM: ${width}x${height}, ${this.frames.length} frames at ${animationSpeed}fps`);

        try {
            // Create a canvas for rendering frames
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');

            // Create MediaRecorder
            const stream = canvas.captureStream(animationSpeed);
            
            // For lossless quality, try to use better codecs
            let mimeType = 'video/webm';
            if (quality === 'lossless') {
                // Try VP9 codec for better quality
                if (MediaRecorder.isTypeSupported('video/webm; codecs="vp9"')) {
                    mimeType = 'video/webm; codecs="vp9"';
                    console.log('Using VP9 codec for lossless quality');
                }
            }
            
            const mediaRecorder = new MediaRecorder(stream, {
                mimeType: mimeType,
                videoBitsPerSecond: this.getVideoBitrate(quality)
            });

            const chunks = [];
            mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) {
                    chunks.push(e.data);
                }
            };

            return new Promise(async (resolve, reject) => {
                mediaRecorder.onstop = () => {
                    const blob = new Blob(chunks, { type: 'video/webm' });
                    console.log(`WebM created: ${blob.size} bytes`);
                    resolve(blob);
                };

                mediaRecorder.onerror = (error) => {
                    console.error('MediaRecorder error:', error);
                    reject(error);
                };

                // Start recording
                mediaRecorder.start();

                // Play frames
                const frameDelay = 1000 / animationSpeed;
                for (let i = 0; i < this.frames.length; i++) {
                    const img = await this.loadImage(this.frames[i]);
                    ctx.clearRect(0, 0, width, height);
                    ctx.drawImage(img, 0, 0, width, height);
                    
                    // Update progress
                    this.onProgress(i + 1, this.frames.length, 'encoding', 'webm');
                    
                    // Wait for next frame
                    await new Promise(resolve => setTimeout(resolve, frameDelay));
                }

                // Stop recording
                mediaRecorder.stop();
            });
        } catch (error) {
            console.error('Error creating WebM:', error);
            throw error;
        }
    }

    async createMP4(settings = {}) {
        const {
            width = this.imageProcessor.canvas.width,
            height = this.imageProcessor.canvas.height,
            animationSpeed = 30, // Matched FPS for consistency
            quality = 'medium'
        } = settings;

        console.log(`Creating MP4: ${width}x${height}, ${this.frames.length} frames at ${animationSpeed}fps`);

        try {
            // Check if MP4 is supported, prioritize high-quality codecs for lossless
            let supportedTypes;
            if (quality === 'lossless') {
                // Prioritize high-quality codecs for lossless
                supportedTypes = [
                    'video/mp4; codecs="avc1.640034"', // H.264 High Profile Level 5.2
                    'video/mp4; codecs="avc1.64002A"', // H.264 High Profile Level 4.2  
                    'video/mp4; codecs="avc1.4D401F"', // H.264 Main Profile Level 3.1
                    'video/mp4; codecs="avc1.42E01E"',
                    'video/mp4',
                    'video/mp4; codecs="h264"'
                ];
            } else {
                supportedTypes = [
                    'video/mp4; codecs="avc1.42E01E"',
                    'video/mp4; codecs="avc1.4D401E"',
                    'video/mp4',
                    'video/mp4; codecs="h264"'
                ];
            }
            
            let supportedMimeType = null;
            for (const type of supportedTypes) {
                if (MediaRecorder.isTypeSupported(type)) {
                    supportedMimeType = type;
                    console.log(`Using MP4 format: ${type}`);
                    break;
                }
            }
            
            if (!supportedMimeType) {
                throw new Error('MP4 format not supported by this browser');
            }

            // Create a canvas for rendering frames
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');

            // Create MediaRecorder
            const stream = canvas.captureStream(animationSpeed);
            const mediaRecorder = new MediaRecorder(stream, {
                mimeType: supportedMimeType,
                videoBitsPerSecond: this.getVideoBitrate(quality)
            });

            const chunks = [];
            mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) {
                    chunks.push(e.data);
                }
            };

            return new Promise(async (resolve, reject) => {
                mediaRecorder.onstop = () => {
                    const blob = new Blob(chunks, { type: 'video/mp4' });
                    console.log(`MP4 created: ${blob.size} bytes`);
                    resolve(blob);
                };

                mediaRecorder.onerror = (error) => {
                    console.error('MP4 MediaRecorder error:', error);
                    reject(error);
                };

                // Start recording
                mediaRecorder.start();

                // Play frames
                const frameDelay = 1000 / animationSpeed;
                for (let i = 0; i < this.frames.length; i++) {
                    const img = await this.loadImage(this.frames[i]);
                    ctx.clearRect(0, 0, width, height);
                    ctx.drawImage(img, 0, 0, width, height);
                    
                    // Update progress
                    this.onProgress(i + 1, this.frames.length, 'encoding', 'MP4');
                    
                    // Wait for next frame
                    await new Promise(resolve => setTimeout(resolve, frameDelay));
                }

                // Stop recording
                mediaRecorder.stop();
            });
        } catch (error) {
            console.error('Error creating MP4:', error);
            throw error;
        }
    }

    // Get video bitrate based on quality setting
    getVideoBitrate(quality) {
        const bitrates = {
            low: 5000000,     // 5 Mbps
            medium: 10000000, // 10 Mbps (default)
            high: 20000000,   // 20 Mbps
            lossless: 100000000 // 100 Mbps - Very high bitrate for near-lossless quality
        };
        return bitrates[quality] || bitrates.medium;
    }

    // Helper method to update progress text
    updateProgressText(text) {
        if (typeof document !== 'undefined' && document.getElementById('progressText')) {
            document.getElementById('progressText').textContent = text;
        }
        console.log(text);
    }

    clearFrames() {
        this.frames = [];
    }
};