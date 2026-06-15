/**
 * Download Button Handlers for Email Signature Generator
 * Manages the download button initialization and click behavior for email signatures
 */

// Import modules for module environment
if (typeof require !== 'undefined') {
    const DEBUG = require('../debug');
}

const downloadButtons = {
    // Track initialization status
    _initialized: false,

    /**
     * Initializes download functionality for all signatures
     * @param {boolean} force - Force re-initialization even if already initialized
     */
    initializeSignatureDownload: function(force = false) {
        DEBUG.info('Initializing signature download buttons...');
        
        // Track this initialization to prevent duplicates
        if (this._initialized && !force) {
            DEBUG.info('Download buttons already initialized, skipping...');
            return;
        }
        
        const signatures = document.querySelectorAll('.signature');
        
        signatures.forEach((signature, index) => {
            // Skip if this signature already has a download button
            if (signature.parentNode && signature.parentNode.classList.contains('signature-wrapper')) {
                DEBUG.info('Signature already has a wrapper, skipping:', signature);
                // But make sure the button is up to date
                const existingButton = signature.parentNode.querySelector('.download-button');
                if (existingButton) {
                    DEBUG.info('Updating existing download button');
                    this.updateDownloadButton(existingButton, signature);
                }
                return;
            }
            
            signature.setAttribute('data-index', index);
            
            // Create a wrapper div for the signature and its download button
            const signatureWrapper = document.createElement('div');
            signatureWrapper.className = 'signature-wrapper';
            
            // Insert the wrapper before the signature
            signature.parentNode.insertBefore(signatureWrapper, signature);
            
            // Move the signature into the wrapper
            signatureWrapper.appendChild(signature);
            
            // Create buttons container
            const buttonsContainer = document.createElement('div');
            buttonsContainer.className = 'signature-buttons';
            signatureWrapper.appendChild(buttonsContainer);
            
            // Create download button and place it in the buttons container
            const downloadButton = document.createElement('button');
            downloadButton.className = 'download-button';
            downloadButton.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg> Download Signature';
            
            buttonsContainer.appendChild(downloadButton);
            
            // Add click event to download button
            this.updateDownloadButton(downloadButton, signature);
            
            // Remove the click event from the signature element to prevent conflicts
            if (signature.downloadHandler) {
                signature.removeEventListener('click', signature.downloadHandler);
            }
            
            // Usage-data disclaimer removed: this standalone applet collects NO usage data. The legacy
            // WordPress download-tracking module was deleted entirely, so there is nothing to disclose.
        });
        
        // Mark as initialized
        this._initialized = true;
    },
    
    /**
     * Updates a download button with the correct event handler
     * @param {HTMLElement} button - The download button
     * @param {HTMLElement} signature - The signature element
     */
    updateDownloadButton: function(button, signature) {
        // Remove existing click events
        const newButton = button.cloneNode(true);
        button.parentNode.replaceChild(newButton, button);
        
        // Generate a unique ID for this download button if it doesn't exist
        if (!newButton.getAttribute('data-download-id')) {
            const downloadId = 'download-' + Math.random().toString(36).substr(2, 9);
            newButton.setAttribute('data-download-id', downloadId);
        }
        
        // Get reference to downloadUtils
        const downloadUtils = window.EmailSignatureApp?.DownloadUtils || {};
        
        // Add click event to download button
        newButton.addEventListener('click', async function(e) {
            // Prevent event from bubbling up
            e.stopPropagation();
            e.preventDefault();
            
            // Ensure we're only processing the event for this specific button
            const clickedButton = e.currentTarget;
            
            try {
                // Store reference to the button
                const downloadBtn = clickedButton;
                
                // Change button text to show loading
                const originalButtonText = downloadBtn.innerHTML;
                downloadBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 22c5.421 0 10-4.579 10-10h-2c0 4.337-3.663 8-8 8s-8-3.663-8-8c0-4.336 3.663-8 8-8V2C6.579 2 2 6.58 2 12c0 5.421 4.579 10 10 10z"></path></svg> Preparing...';
                downloadBtn.disabled = true;
                
                // Determine signature type
                let signatureType = '';
                
                // First try to get it from the container
                const containerElement = signature.closest('[id$="-signature-container"]');
                if (containerElement) {
                    signatureType = containerElement.id.replace('-signature-container', '');
                } else {
                    // Try to get it from classes
                    for (const className of signature.classList) {
                        if (className.startsWith('signature-')) {
                            signatureType = className.replace('signature-', '');
                            break;
                        }
                    }
                    
                    // If still not found, use a default
                    if (!signatureType) {
                        signatureType = 'default';
                    }
                }
                
                DEBUG.info(`Creating zip file for ${signatureType} signature...`);
                
                if (!downloadUtils.createSignatureZip) {
                    throw new Error('Download utils module not loaded properly. Please refresh the page and try again.');
                }
                
                // Create the zip file
                const zip = await downloadUtils.createSignatureZip(signature);
                
                // Download the zip file
                DEBUG.info('Downloading zip file...');
                await downloadUtils.downloadFile(zip, `gbti-network-${signatureType}-signature.zip`);
                
                // Usage tracking intentionally NOT called: this standalone applet collects no usage data.

                // Reset button state
                downloadBtn.innerHTML = originalButtonText;
                downloadBtn.disabled = false;
                
                DEBUG.info('Download complete!');
            } catch (error) {
                DEBUG.error('Error during download:', error);
                
                // Reset button state and show error
                clickedButton.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg> Try Again';
                clickedButton.disabled = false;
                
                // Show an error message to the user
                alert('Error generating signature: ' + error.message);
            }
        });
    }
};

// For browser use
if (typeof window !== 'undefined') {
    // Initialize the DEBUG module if it exists in the browser environment
    if (window.DEBUG && typeof window.DEBUG.init === 'function') {
        // Use the global EmailSignatureGeneratorConfig if available
        if (typeof EmailSignatureGeneratorConfig !== 'undefined') {
            window.DEBUG.init(EmailSignatureGeneratorConfig);
        } else {
            window.DEBUG.init({ debug: { enabled: true, logLevel: 'info' } });
        }
    }
    
    window.EmailSignatureApp = window.EmailSignatureApp || {};
    window.EmailSignatureApp.DownloadButtons = downloadButtons;
}

// Helper initialization functions for global access
window.initializeSignatureDownloadButtons = function(force = false) {
    DEBUG.info('Global initialization function called');
    if (window.EmailSignatureApp && window.EmailSignatureApp.DownloadButtons) {
        window.EmailSignatureApp.DownloadButtons.initializeSignatureDownload(force);
    } else {
        DEBUG.warn('Download buttons module not loaded yet');
    }
};

// Initialize when document is ready
if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', function() {
        DEBUG.info('DOMContentLoaded - Initializing download buttons');
        if (window.EmailSignatureApp && window.EmailSignatureApp.DownloadButtons) {
            window.EmailSignatureApp.DownloadButtons.initializeSignatureDownload();
        } else {
            DEBUG.error('EmailSignatureApp.DownloadButtons not available on DOMContentLoaded');
            // Try with a slight delay as a fallback
            setTimeout(function() {
                if (window.EmailSignatureApp && window.EmailSignatureApp.DownloadButtons) {
                    window.EmailSignatureApp.DownloadButtons.initializeSignatureDownload();
                }
            }, 500);
        }
    });
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = downloadButtons;
}
