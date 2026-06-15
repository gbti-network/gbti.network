/**
 * Modularized loader for file:// protocol support
 * Loads individual inline modules instead of bundling everything in one file
 */

class ModuleLoader {
    constructor() {
        this.isFileProtocol = window.location.protocol === 'file:';
        this.modules = {};
        // Get base URL from WordPress config if available
        this.baseUrl = (typeof JSAnimateHueConfig !== 'undefined' && JSAnimateHueConfig.toolBaseUrl) 
            ? JSAnimateHueConfig.toolBaseUrl 
            : './';
    }

    async loadModules() {
        // Always load inline modules (ES6 modules no longer supported)
        await this.loadInlineModules();
    }

    async loadInlineModules() {
        console.log('Loading inline modules...');
        
        // Get version for cache busting
        const version = (typeof JSAnimateHueConfig !== 'undefined' && JSAnimateHueConfig.themeVersion) 
            ? JSAnimateHueConfig.themeVersion 
            : Date.now();
        
        // Load individual inline module files using base URL with version
        const moduleFiles = [
            this.baseUrl + 'inline-modules/colorUtils.js?ver=' + version,
            this.baseUrl + 'inline-modules/imageProcessor.js?ver=' + version, 
            this.baseUrl + 'inline-modules/animator.js?ver=' + version,
            this.baseUrl + 'inline-modules/hueSelector.js?ver=' + version,
            this.baseUrl + 'inline-modules/presets.js?ver=' + version,
            this.baseUrl + 'inline-modules/animateHueApp.js?ver=' + version
        ];

        // Load each module file
        for (const moduleFile of moduleFiles) {
            try {
                await this.loadScript(moduleFile);
                //console.log(`Loaded ${moduleFile}`);
            } catch (error) {
                console.error(`Failed to load ${moduleFile}:`, error);
                throw error;
            }
        }
        
        console.log('All inline modules loaded successfully');
    }

    loadScript(src) {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = src;
            script.onload = resolve;
            script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
            document.head.appendChild(script);
        });
    }
}

// Initialize the application
function initializeApp() {
    console.log('Initializing app, DOM ready state:', document.readyState);
    
    const loader = new ModuleLoader();
    loader.loadModules().then(() => {
        // Initialize the main app
        console.log('Modules loaded, creating AnimateHueApp...');
        const app = new window.AnimateHueApp();
        window.app = app; // Make app globally accessible for debugging
    }).catch(error => {
        console.error('Failed to initialize app:', error);
    });
}

// Ensure DOM is ready before initializing
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeApp);
} else {
    // DOM is already ready
    initializeApp();
}