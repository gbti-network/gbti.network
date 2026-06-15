/**
 * AnimateHueApp Inline Module
 * 
 * Standalone AnimateHueApp class module for file:// protocol support.
 * This module provides the main application logic for the hue animation tool,
 * including image processing, user interface handling, and animation generation.
 */

window.AnimateHueApp = class AnimateHueApp {
    constructor() {
        this.imageProcessor = null;
        this.animator = null;
        this.hueSelector = null;
        this.currentImage = null;
        this.sponsorShown = false; // Track if sponsor section has been shown
        
        this.settings = {
            startHue: -180,
            endHue: 180,
            startBrightness: 0,
            endBrightness: 0,
            startContrast: 0,
            endContrast: 0,
            frameCount: 60,
            animationSpeed: 60,
            loopAnimation: false
        };
        
        this.init();
    }

    async init() {
        // Small delay to ensure DOM is fully rendered
        await new Promise(resolve => setTimeout(resolve, 100));
        
        this.setupCanvas();
        this.setupEventListeners();
    }

    setupCanvas() {
        const canvas = document.getElementById('processingCanvas');
        this.imageProcessor = new window.ImageProcessor(canvas);
        this.animator = new window.Animator(this.imageProcessor, this.onProgress.bind(this));
    }

    setupEventListeners() {
        // File input
        const fileInput = document.getElementById('fileInput');
        const dropZone = document.getElementById('dropZone');
        
        console.log('Setting up event listeners...');
        console.log('fileInput element:', fileInput);
        console.log('dropZone element:', dropZone);
        console.log('DOM ready state when setting up listeners:', document.readyState);
        
        if (!fileInput || !dropZone) {
            console.error('Required elements not found!');
            console.error('Available elements with IDs:', Array.from(document.querySelectorAll('[id]')).map(el => el.id));
            return;
        }
        
        fileInput.addEventListener('change', (e) => {
            console.log('File input changed:', e.target.files);
            if (e.target.files.length > 0) {
                this.handleFileSelect(e.target.files[0]);
            }
        });

        // Drag and drop
        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropZone.classList.add('drag-over');
        });

        dropZone.addEventListener('dragleave', () => {
            dropZone.classList.remove('drag-over');
        });

        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.classList.remove('drag-over');
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                this.handleFileSelect(files[0]);
            }
        });

        // Click on drop zone to open file dialog
        dropZone.addEventListener('click', (e) => {
            console.log('Drop zone clicked, triggering file input...');
            console.log('Click event:', e);
            console.log('FileInput element at click time:', fileInput);
            
            if (fileInput) {
                fileInput.click();
            } else {
                console.error('FileInput not available at click time');
            }
        });
        
        // Test that click listener was attached
        console.log('Drop zone click listener attached successfully');

        // Control sliders
        document.getElementById('frameCount').addEventListener('input', (e) => {
            this.settings.frameCount = parseInt(e.target.value);
            document.getElementById('frameCountValue').textContent = e.target.value;
            this.updateFileSizeEstimate();
            this.updateAnimationDuration();
        });

        document.getElementById('animationSpeed').addEventListener('input', (e) => {
            this.settings.animationSpeed = parseInt(e.target.value);
            document.getElementById('animationSpeedValue').textContent = `${e.target.value} FPS`;
            this.updateAnimationDuration();
        });

        document.getElementById('loopAnimation').addEventListener('change', (e) => {
            this.settings.loopAnimation = e.target.checked;
            this.updateFileSizeEstimate(); // Update estimate since loop doubles frames
            this.updateAnimationDuration();
        });

        document.getElementById('brightnessStart').addEventListener('input', (e) => {
            this.settings.startBrightness = parseInt(e.target.value);
            document.getElementById('brightnessStartValue').textContent = e.target.value;
        });

        document.getElementById('brightnessEnd').addEventListener('input', (e) => {
            this.settings.endBrightness = parseInt(e.target.value);
            document.getElementById('brightnessEndValue').textContent = e.target.value;
        });

        document.getElementById('contrastStart').addEventListener('input', (e) => {
            this.settings.startContrast = parseInt(e.target.value);
            document.getElementById('contrastStartValue').textContent = e.target.value;
        });

        document.getElementById('contrastEnd').addEventListener('input', (e) => {
            this.settings.endContrast = parseInt(e.target.value);
            document.getElementById('contrastEndValue').textContent = e.target.value;
        });

        // Generate button
        document.getElementById('generateBtn').addEventListener('click', () => {
            this.generateAnimation();
        });

        // Create new button
        document.getElementById('createNewBtn').addEventListener('click', () => {
            this.resetApp();
        });

        // Format change listeners
        document.querySelectorAll('input[name="format"]').forEach(radio => {
            radio.addEventListener('change', () => {
                this.updateFileSizeEstimate();
            });
        });

        // Tab switching
        this.setupTabSwitching();
    }

    async handleFileSelect(file) {
        if (!file || !file.type.startsWith('image/')) return;

        try {
            this.currentImage = await this.imageProcessor.loadImage(file);
            
            // Show image preview
            const preview = document.getElementById('previewImg');
            const reader = new FileReader();
            reader.onload = (e) => {
                preview.src = e.target.result;
            };
            reader.readAsDataURL(file);

            // Show controls
            document.getElementById('dropZone').querySelector('.drop-zone-content').style.display = 'none';
            document.getElementById('imagePreview').style.display = 'block';
            document.getElementById('visualEffectsSection').style.display = 'block';
            document.getElementById('animationSettingsSection').style.display = 'block';

            // Setup hue selector
            this.setupHueSelector();
            this.updateGradientPreview();
            this.updateFileSizeEstimate();
            this.updateAnimationDuration();
            
            // Initialize resolution controls
            if (typeof window.initializeResolutionControls === 'function') {
                window.initializeResolutionControls(this.currentImage.width, this.currentImage.height);
            }
        } catch (error) {
            console.error('Error loading image:', error);
            alert('Failed to load image. Please try again.');
        }
    }

    setupHueSelector() {
        const svg = document.getElementById('hueSelector');
        svg.innerHTML = '';
        
        this.hueSelector = new window.HueSelector(svg, (values) => {
            this.settings.startHue = values.startHue;
            this.settings.endHue = values.endHue;
            
            document.getElementById('startHueValue').textContent = `${Math.round(values.startHue)}°`;
            document.getElementById('endHueValue').textContent = `${Math.round(values.endHue)}°`;
            
            this.updateGradientPreview();
        });

        this.hueSelector.setValues(this.settings.startHue, this.settings.endHue);
    }

    updateGradientPreview() {
        const preview = document.getElementById('gradientPreview');
        const stops = window.ColorUtils.createGradientStops(this.settings.startHue, this.settings.endHue, 20);
        const gradient = `linear-gradient(to right, ${stops.join(', ')})`;
        preview.style.background = gradient;
    }

    updateFileSizeEstimate() {
        if (!this.currentImage) return;
        
        // Calculate actual frame count (double if looping)
        const actualFrameCount = this.settings.loopAnimation ? this.settings.frameCount * 2 : this.settings.frameCount;
        
        // Use scaled dimensions if available
        const width = this.settings.outputWidth || this.currentImage.width;
        const height = this.settings.outputHeight || this.currentImage.height;
        const pixelsPerFrame = width * height;
        
        // Get selected format
        const format = document.querySelector('input[name="format"]:checked')?.value || 'mp4';
        
        let estimateText = '';
        const loopText = this.settings.loopAnimation ? ` (${actualFrameCount} total with loop)` : '';
        
        if (format === 'gif') {
            // GIF uses palette compression, lower quality = smaller size
            const bytesPerFrame = pixelsPerFrame * 0.6; // GIF compression
            const totalBytes = bytesPerFrame * actualFrameCount;
            const sizeMB = (totalBytes / (1024 * 1024)).toFixed(1);
            estimateText = `${this.settings.frameCount} frames${loopText} = ~${sizeMB}MB GIF estimated`;
        } else if (format === 'webm') {
            // WebM uses video compression, size varies by quality
            const quality = document.querySelector('input[name="videoQuality"]:checked')?.value || 'medium';
            const qualityMultipliers = { low: 0.3, medium: 0.5, high: 1.0, lossless: 3.0 }; // Base size multipliers
            const baseSize = qualityMultipliers[quality] || 0.5; // Base size in MB for 60 frames at ~1000x700
            const resolutionFactor = pixelsPerFrame / (1111 * 741); // Scale by resolution
            const frameFactor = actualFrameCount / 60; // Scale by frame count
            const estimatedSize = baseSize * resolutionFactor * frameFactor;
            const qualityLabel = quality === 'lossless' ? 'highest/lossless' : quality;
            estimateText = `${this.settings.frameCount} frames${loopText} = ~${estimatedSize.toFixed(1)}MB WebM (${qualityLabel}) estimated`;
        } else if (format === 'mp4') {
            // MP4 uses similar compression to WebM but typically slightly larger
            const quality = document.querySelector('input[name="videoQuality"]:checked')?.value || 'medium';
            const qualityMultipliers = { low: 0.4, medium: 0.7, high: 1.2, lossless: 4.0 }; // Base size multipliers
            const baseSize = qualityMultipliers[quality] || 0.7; // Base size in MB for 60 frames at ~1000x700
            const resolutionFactor = pixelsPerFrame / (1111 * 741); // Scale by resolution
            const frameFactor = actualFrameCount / 60; // Scale by frame count
            const estimatedSize = baseSize * resolutionFactor * frameFactor;
            const qualityLabel = quality === 'lossless' ? 'highest/lossless' : quality;
            estimateText = `${this.settings.frameCount} frames${loopText} = ~${estimatedSize.toFixed(1)}MB MP4 (${qualityLabel}) estimated`;
        }
        
        document.getElementById('fileSizeEstimate').textContent = estimateText;
    }

    updateAnimationDuration() {
        if (!this.currentImage) return;
        
        // Calculate actual frame count (double if looping)
        const actualFrameCount = this.settings.loopAnimation ? this.settings.frameCount * 2 : this.settings.frameCount;
        
        // Calculate duration based on animation speed (FPS)
        const durationSeconds = actualFrameCount / this.settings.animationSpeed;
        
        // Format duration nicely
        let durationText;
        if (durationSeconds < 1) {
            durationText = `${(durationSeconds * 1000).toFixed(0)}ms`;
        } else if (durationSeconds < 60) {
            durationText = `${durationSeconds.toFixed(1)} seconds`;
        } else {
            const minutes = Math.floor(durationSeconds / 60);
            const seconds = Math.round(durationSeconds % 60);
            durationText = `${minutes}m ${seconds}s`;
        }
        
        const loopText = this.settings.loopAnimation ? ' (looped)' : '';
        document.getElementById('animationDuration').textContent = `Animation Length: ${durationText}${loopText}`;
    }

    async generateAnimation() {
        if (!this.currentImage) {
            alert('Please select an image first');
            return;
        }

        document.getElementById('progressSection').style.display = 'block';
        document.getElementById('generateBtn').disabled = true;
        document.getElementById('generateBtn').textContent = 'Generating...';
        
        // Scroll to progress section during generation with a slight delay to ensure DOM is updated
        setTimeout(() => {
            document.getElementById('progressSection').scrollIntoView({ 
                behavior: 'smooth', 
                block: 'start' 
            });
        }, 100);

        try {
            await this.animator.generateFrames(this.settings);

            const results = {};
            const format = document.querySelector('input[name="format"]:checked').value;

            if (format === 'gif') {
                // Update progress text for GIF generation
                document.getElementById('progressText').textContent = 'Generating GIF animation...';
                results.gif = await this.animator.createGIF({
                    width: this.settings.outputWidth || this.currentImage.width,
                    height: this.settings.outputHeight || this.currentImage.height,
                    animationSpeed: this.settings.animationSpeed,
                    loopAnimation: this.settings.loopAnimation
                });
            } else if (format === 'webm') {
                // Update progress text for WebM generation
                document.getElementById('progressText').textContent = 'Generating WebM video...';
                const quality = document.querySelector('input[name="videoQuality"]:checked')?.value || 'medium';
                results.webm = await this.animator.createWebM({
                    width: this.settings.outputWidth || this.currentImage.width,
                    height: this.settings.outputHeight || this.currentImage.height,
                    animationSpeed: this.settings.animationSpeed,
                    quality: quality
                });
            } else if (format === 'mp4') {
                // Update progress text for MP4 generation
                document.getElementById('progressText').textContent = 'Generating MP4 video...';
                const quality = document.querySelector('input[name="videoQuality"]:checked')?.value || 'medium';
                results.mp4 = await this.animator.createMP4({
                    width: this.settings.outputWidth || this.currentImage.width,
                    height: this.settings.outputHeight || this.currentImage.height,
                    animationSpeed: this.settings.animationSpeed,
                    quality: quality
                });
            }

            this.showResults(results);
        } catch (error) {
            console.error('Error generating animation:', error);
            alert(`Failed to generate animation: ${error.message}`);
            this.resetProgress();
        }
    }

    onProgress(current, total, phase = 'processing', format = '') {
        const percent = (current / total) * 100;
        document.getElementById('progressFill').style.width = `${percent}%`;
        
        if (phase === 'processing') {
            document.getElementById('progressText').textContent = `Processing frame ${current} of ${total}`;
        } else if (phase === 'encoding') {
            const formatText = format ? ` into ${format.toUpperCase()}` : '';
            document.getElementById('progressText').textContent = `Encoding frame ${current} of ${total}${formatText}`;
        } else if (phase === 'finalizing') {
            const formatText = format ? ` ${format.toUpperCase()}` : '';
            document.getElementById('progressText').textContent = `Finalizing${formatText} animation...`;
        }
    }

    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    showResults(results) {
        document.getElementById('progressSection').style.display = 'none';
        document.getElementById('resultsSection').style.display = 'block';
        
        // Sponsor banner intentionally NOT shown: the GBTI tool page leads with the community CTA and
        // surfaces latest content instead. The #sponsorPersistent element stays hidden (display:none).
        this.sponsorShown = true;

        // Show social footer section after generation (if it exists)
        const socialFooterSection = document.getElementById('socialFooterSection');
        if (socialFooterSection) {
            socialFooterSection.style.display = 'block';
        }
        
        document.getElementById('generateBtn').disabled = false;
        document.getElementById('generateBtn').textContent = 'Generate Again';

        if (results.gif) {
            const gifUrl = URL.createObjectURL(results.gif);
            
            // GIF should always use img element, never video
            const currentPreview = document.getElementById('resultPreview');
            if (currentPreview.tagName === 'VIDEO') {
                // Replace video with img for GIF
                const img = document.createElement('img');
                img.id = 'resultPreview';
                img.alt = 'GIF animation preview';
                currentPreview.replaceWith(img);
            }
            document.getElementById('resultPreview').src = gifUrl;
            
            const downloadGif = document.getElementById('downloadGif');
            const gifSize = this.formatFileSize(results.gif.size);
            downloadGif.textContent = `Download GIF (${gifSize})`;
            downloadGif.style.display = 'inline-block';
            downloadGif.onclick = () => {
                const a = document.createElement('a');
                a.href = gifUrl;
                a.download = `${this.currentImage.name.split('.')[0]}-animated.gif`;
                a.click();
            };
        } else {
            document.getElementById('downloadGif').style.display = 'none';
        }

        if (results.webm) {
            const webmUrl = URL.createObjectURL(results.webm);
            
            if (!results.gif) {
                const video = document.createElement('video');
                video.src = webmUrl;
                video.controls = true;
                video.loop = true;
                video.autoplay = true;
                document.getElementById('resultPreview').replaceWith(video);
                video.id = 'resultPreview';
            }
            
            const downloadWebm = document.getElementById('downloadWebm');
            const webmSize = this.formatFileSize(results.webm.size);
            downloadWebm.textContent = `Download WebM (${webmSize})`;
            downloadWebm.style.display = 'inline-block';
            downloadWebm.onclick = () => {
                const a = document.createElement('a');
                a.href = webmUrl;
                a.download = `${this.currentImage.name.split('.')[0]}-animated.webm`;
                a.click();
            };
        } else {
            document.getElementById('downloadWebm').style.display = 'none';
        }

        if (results.mp4) {
            const mp4Url = URL.createObjectURL(results.mp4);
            
            if (!results.gif && !results.webm) {
                // Show video preview if no GIF or WebM
                const video = document.createElement('video');
                video.src = mp4Url;
                video.controls = true;
                video.loop = true;
                video.autoplay = true;
                document.getElementById('resultPreview').replaceWith(video);
                video.id = 'resultPreview';
            }
            
            const downloadMp4 = document.getElementById('downloadMp4');
            const mp4Size = this.formatFileSize(results.mp4.size);
            downloadMp4.textContent = `Download MP4 (${mp4Size})`;
            downloadMp4.style.display = 'inline-block';
            downloadMp4.onclick = () => {
                const a = document.createElement('a');
                a.href = mp4Url;
                a.download = `${this.currentImage.name.split('.')[0]}-animated.mp4`;
                a.click();
            };
        } else {
            document.getElementById('downloadMp4').style.display = 'none';
        }

        this.animator.clearFrames();
        
        // Scroll to preview section after generation completes with a slight delay
        setTimeout(() => {
            document.getElementById('resultsSection').scrollIntoView({ 
                behavior: 'smooth', 
                block: 'start' 
            });
        }, 300);
    }

    resetProgress() {
        document.getElementById('progressSection').style.display = 'none';
        document.getElementById('generateBtn').disabled = false;
        document.getElementById('generateBtn').textContent = 'Generate Animation';
        document.getElementById('progressFill').style.width = '0%';
    }

    resetApp() {
        document.getElementById('resultsSection').style.display = 'none';
        document.getElementById('visualEffectsSection').style.display = 'none';
        document.getElementById('animationSettingsSection').style.display = 'none';
        document.getElementById('imagePreview').style.display = 'none';
        document.getElementById('dropZone').querySelector('.drop-zone-content').style.display = 'block';
        
        this.currentImage = null;
        document.getElementById('fileInput').value = '';
        
        // Reset download button text
        document.getElementById('downloadGif').textContent = 'Download GIF';
        document.getElementById('downloadWebm').textContent = 'Download WebM';
        document.getElementById('downloadMp4').textContent = 'Download MP4';
        
        this.applySettings({
            startHue: -180,
            endHue: 180,
            startBrightness: 0,
            endBrightness: 0,
            startContrast: 0,
            endContrast: 0,
            frameCount: 60,
            animationSpeed: 60,
            loopAnimation: false
        });
        
        this.resetProgress();
    }

    applySettings(settings) {
        this.settings = { ...this.settings, ...settings };
        
        document.getElementById('frameCount').value = this.settings.frameCount;
        document.getElementById('frameCountValue').textContent = this.settings.frameCount;
        
        document.getElementById('animationSpeed').value = this.settings.animationSpeed;
        document.getElementById('animationSpeedValue').textContent = `${this.settings.animationSpeed} FPS`;
        
        document.getElementById('loopAnimation').checked = this.settings.loopAnimation;
        
        document.getElementById('brightnessStart').value = this.settings.startBrightness;
        document.getElementById('brightnessStartValue').textContent = this.settings.startBrightness;
        document.getElementById('brightnessEnd').value = this.settings.endBrightness;
        document.getElementById('brightnessEndValue').textContent = this.settings.endBrightness;
        
        document.getElementById('contrastStart').value = this.settings.startContrast;
        document.getElementById('contrastStartValue').textContent = this.settings.startContrast;
        document.getElementById('contrastEnd').value = this.settings.endContrast;
        document.getElementById('contrastEndValue').textContent = this.settings.endContrast;
        
        if (this.hueSelector) {
            this.hueSelector.setValues(this.settings.startHue, this.settings.endHue);
        }
        
        this.updateGradientPreview();
        this.updateFileSizeEstimate();
    }

    setupTabSwitching() {
        const tabButtons = document.querySelectorAll('.tab-btn');
        const tabPanels = document.querySelectorAll('.tab-panel');

        tabButtons.forEach(button => {
            button.addEventListener('click', () => {
                const targetTab = button.getAttribute('data-tab');
                
                tabButtons.forEach(btn => btn.classList.remove('active'));
                tabPanels.forEach(panel => panel.classList.remove('active'));
                
                button.classList.add('active');
                document.getElementById(`${targetTab}-tab`).classList.add('active');
            });
        });
    }
};