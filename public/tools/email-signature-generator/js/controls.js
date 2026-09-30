/**
 * Email Signature Controls
 * This file handles all the interactive controls for customizing email signatures
 */

// Use the global CONFIG object defined in config.js
// import CONFIG from './config.js';

// Global initialization function
window.EmailSignatureApp = window.EmailSignatureApp || {};

/**
 * Initialize the application
 */
function init() {
    DEBUG.info('Initializing app');
    
    // Get template selector
    const templateSelector = document.getElementById('template-selector');
    if (templateSelector) {
        // Add event listener for template change
        templateSelector.addEventListener('change', function() {
            const selectedTemplate = this.value;
            selectTemplate(selectedTemplate);
        });
    }
    
    // Initialize tabs
    initializeTabs();
    
    // Initialize form fields
    initializeFormFields();
    
    // Initialize color pickers
    initializeColorPickers();
    
    // Initialize image handlers using the new module
    EmailSignatureApp.ImageHandlers.initialize();
    
    // Initialize download buttons
    initializeDownloadButtons();
    
    // Load default template with a delay to ensure everything is ready
    setTimeout(() => {
        try {
            if (CONFIG && CONFIG.defaultTemplate) {
                loadTemplate(CONFIG.defaultTemplate);
            } else {
                loadTemplate('classic'); // Default fallback
            }
        } catch (error) {
            console.error('Error loading template:', error);
        }
    }, 300);
    
    // Set a timeout to give everything a chance to load before updating signatures
    setTimeout(function() {
        updateSignatures();
    }, 500);
    
    DEBUG.info('App initialization complete');
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
    // Wait a short time to ensure all scripts are loaded
    setTimeout(init, 100);
});

/**
 * Initialize all controls - DEPRECATED, functionality moved to init()
 * This function is kept for backward compatibility but is no longer used
 */
function initializeControls() {
    console.warn('initializeControls is deprecated, functionality moved to init()');
    // No-op, functionality moved to init()
}

function initializeFormFields() {
    // Personal Information
    setInputValueAndPlaceholder('input-name', CONFIG.defaults.name, CONFIG.placeholders.name);
    setInputValueAndPlaceholder('input-title', CONFIG.defaults.title, CONFIG.placeholders.title);
    setInputValueAndPlaceholder('input-email', CONFIG.defaults.email, CONFIG.placeholders.email);
    setInputValueAndPlaceholder('input-calendly', CONFIG.defaults.calendly, CONFIG.placeholders.calendly);
    setInputValueAndPlaceholder('input-calendly-text', CONFIG.defaults.calendlyText, CONFIG.placeholders.calendlyText);
    setInputValueAndPlaceholder('input-company', CONFIG.defaults.company, CONFIG.placeholders.company);
    
    // Add event listeners for real-time updating
    addInputChangeListener('input-name');
    addInputChangeListener('input-title');
    addInputChangeListener('input-company');
    addInputChangeListener('input-email');
    addInputChangeListener('input-calendly');
    addInputChangeListener('input-calendly-text');
    
    // Initialize border radius controls
    initializeBorderRadiusControls();
}

/**
 * Add change listener to input field to update signatures in real-time
 * @param {string} inputId - The ID of the input element
 */
function addInputChangeListener(inputId) {
    const input = document.getElementById(inputId);
    if (input) {
        // Add input event for real-time updates as typing occurs
        input.addEventListener('input', function() {
            // Save to localStorage
            localStorage.setItem(`signature-${inputId}`, input.value);
            // Update signatures
            updateSignatures();
        });
    }
}

/** @param {string} inputId  @param {string} defaultValue  @param {string} placeholder */
function setInputValueAndPlaceholder(inputId, defaultValue, placeholder) {
    const input = document.getElementById(inputId);
    if (!input) return;
    
    // Set placeholder
    input.placeholder = placeholder || '';
    
    // Get saved value from localStorage or use default
    const savedValue = localStorage.getItem(`signature-${inputId}`);
    input.value = savedValue || defaultValue || '';
}

function updateSignatures() {
    DEBUG.info('Updating all signatures...');
    
    try {
        // Update text content
        updateTextContent();
        
        // Update colors
        updateSignatureColors();
        
        // Update images using new module if available
        if (typeof EmailSignatureApp.ImageHandlers !== 'undefined') {
            EmailSignatureApp.ImageHandlers.updateImages();
        } else {
            console.warn('ImageHandlers module not found, cannot update images');
        }
        
        // Update social icons using the new module if available
        if (window.EmailSignatureApp && window.EmailSignatureApp.SocialIcons && 
            typeof window.EmailSignatureApp.SocialIcons.updateSocialIcons === 'function') {
            window.EmailSignatureApp.SocialIcons.updateSocialIcons();
        } else {
            // Legacy fallback
            updateSocialIcons();
        }
        
        DEBUG.info('All signatures updated successfully');
    } catch (error) {
        console.error('Error updating signatures:', error);
    }
}

// Make updateSignatures available globally for backward compatibility
window.updateSignatures = updateSignatures;

function updateTextContent() {
    try {
        // Get form values
        const name = getInputValue('input-name');
        const title = getInputValue('input-title');
        const company = getInputValue('input-company');
        const email = getInputValue('input-email');
        const calendly = getInputValue('input-calendly');
        const calendlyText = getInputValue('input-calendly-text');
        
        // Get all signatures
        const signatures = document.querySelectorAll('.signature');
        
        // Update each signature
        signatures.forEach(signature => {
            // Update name
            const nameElements = signature.querySelectorAll('.name');
            nameElements.forEach(el => {
                el.textContent = name || CONFIG.defaults.name;
            });
            
            // Update title
            const titleElements = signature.querySelectorAll('.title');
            titleElements.forEach(el => {
                el.textContent = title || CONFIG.defaults.title;
            });
            
            // Update company
            const companyNameElements = signature.querySelectorAll('.company-name');
            companyNameElements.forEach(el => {
                el.textContent = company || CONFIG.defaults.company;
            });
            
            // Update email
            const emailElements = signature.querySelectorAll('.email');
            emailElements.forEach(el => {
                el.textContent = email || CONFIG.defaults.email;
                
                // If the element is inside an <a> tag, update the href too
                if (el.parentElement.tagName === 'A') {
                    el.parentElement.href = `mailto:${email || CONFIG.defaults.email}`;
                }
            });
            
            // Update calendly
            const calendlyElements = signature.querySelectorAll('.calendly-link');
            calendlyElements.forEach(el => {
                // If we have a calendly URL
                if (calendly && calendly.trim() !== '') {
                    // Update the href for the calendly link
                    el.href = calendly;
                    
                    // Find parent element that might have .calendly class
                    let parentWithCalendlyClass = el.closest('.calendly');
                    if (parentWithCalendlyClass) {
                        parentWithCalendlyClass.style.display = '';
                    }
                }
            });
            
            // Also handle .calendly elements that are direct social icon links
            const calendlySocialIcons = signature.querySelectorAll('.sig-social-icons a.calendly');
            calendlySocialIcons.forEach(el => {
                if (calendly && calendly.trim() !== '') {
                    el.href = calendly;
                    el.style.display = '';
                }
            });
            
            // Update calendly text
            const calendlyTextElements = signature.querySelectorAll('.calendly-text');
            calendlyTextElements.forEach(el => {
                // Check if this is an element that should have its text content set
                // If the element has children that are not text nodes, don't modify
                // its text content directly
                if (el.childElementCount === 0) {
                    el.textContent = calendlyText || CONFIG.defaults.calendlyText;
                }
            });
        });
        
        DEBUG.info('Text content updated successfully');
    } catch (error) {
        console.error('Error updating text content:', error);
    }
}

/** @returns {string} the input value, or '' when no element has that id. */
function getInputValue(id) {
    const input = document.getElementById(id);
    return input ? input.value : '';
}

function updateColors() {
    // Get color values
    const primaryColor = getInputValue('input-primary-color') || CONFIG.defaults.primaryColor;
    const secondaryColor = getInputValue('input-secondary-color') || CONFIG.defaults.secondaryColor;
    const accentColor = getInputValue('input-accent-color') || CONFIG.defaults.accentColor;
    const backgroundColor = getInputValue('input-background-color') || CONFIG.defaults.backgroundColor;
    
    DEBUG.info('Updating colors:', { primaryColor, secondaryColor, accentColor, backgroundColor });
    
    // Apply primary color to name elements
    document.querySelectorAll('.name').forEach(element => {
        element.style.color = primaryColor;
    });
    
    // Apply secondary color to title and contact elements
    document.querySelectorAll('.title, .contact').forEach(element => {
        element.style.color = secondaryColor;
    });
    
    // Apply accent color to links and highlights
    document.querySelectorAll('a, .highlight, .email').forEach(element => {
        element.style.color = accentColor;
    });
    
    // Apply background color to signature backgrounds
    document.querySelectorAll('.signature').forEach(element => {
        element.style.backgroundColor = backgroundColor;
    });
}

/**
 * Initialize hover effects for social icons - Legacy function kept for backward compatibility
 */
function initializeSocialIconEffects() {
    console.warn('Using legacy initializeSocialIconEffects, consider upgrading to the SocialIcons module');
    const socialIcons = document.querySelectorAll('.social-icon');
    socialIcons.forEach(icon => {
        icon.addEventListener('mouseover', function() {
            this.style.transform = 'scale(1.2)';
        });
        
        icon.addEventListener('mouseout', function() {
            this.style.transform = 'scale(1)';
        });
    });
}

/**
 * Initialize tab navigation
 */
function initializeTabs() {
    const tabs = document.querySelectorAll('.tab');
    
    tabs.forEach(tab => {
        tab.addEventListener('click', function() {
            // Remove active class from all tabs
            tabs.forEach(t => t.classList.remove('active'));
            
            // Add active class to clicked tab
            this.classList.add('active');
            
            // Show corresponding tab content
            const tabId = this.getAttribute('data-tab');
            document.querySelectorAll('.tab-content').forEach(content => {
                content.classList.remove('active');
            });
            
            const activeContent = document.getElementById(tabId);
            if (activeContent) {
                activeContent.classList.add('active');
            }
        });
    });
    
    // Activate first tab by default
    if (tabs.length > 0) {
        tabs[0].click();
    }
}

function initializeColorPickers() {
    // Check current mode
    const isDarkMode = localStorage.getItem('signature-dark-mode') === 'true';
    const mode = isDarkMode ? 'dark' : 'light';
    
    DEBUG.info(`Initializing color pickers for ${mode} mode`);
    
    // Set default values and add event listeners
    const colorPickers = [
        { 
            id: 'input-primary-color', 
            storageKey: `signature-primary-color-${mode}`,
            default: CONFIG.colors[mode].primary
        },
        { 
            id: 'input-secondary-color', 
            storageKey: `signature-secondary-color-${mode}`,
            default: CONFIG.colors[mode].secondary
        },
        { 
            id: 'input-accent-color', 
            storageKey: `signature-accent-color-${mode}`,
            default: CONFIG.colors[mode].accent
        },
        { 
            id: 'input-background-color', 
            storageKey: `signature-background-color-${mode}`,
            default: CONFIG.colors[mode].background
        }
    ];
    
    colorPickers.forEach(picker => {
        const element = document.getElementById(picker.id);
        if (!element) {
            console.warn(`Color picker element not found: ${picker.id}`);
            return;
        }
        
        // Get saved value or use default
        const savedValue = localStorage.getItem(picker.storageKey);
        element.value = savedValue || picker.default;
        DEBUG.info(`Set ${picker.id} to ${element.value} (saved: ${savedValue}, default: ${picker.default})`);
        
        // Update preview box
        updateColorPreview(element);
        
        // Add event listener for real-time updates
        element.addEventListener('input', function() {
            // Update preview box
            updateColorPreview(this);
            
            // Update signatures
            updateSignatureColors();
            updateSignatures();
        });
    });
    
    // Apply the colors
    updateSignatureColors();
    
    DEBUG.info(`Color pickers initialized for ${mode} mode`);
}

function initializeDownloadButtons() {
    try {
        DEBUG.info('Initializing download buttons');
        
        // Get all download buttons
        const downloadButtons = document.querySelectorAll('.download-button');
        
        if (downloadButtons.length === 0) {
            DEBUG.info('No download buttons found, will try initialization from module');
            
            // Use the new module structure if available
            if (window.EmailSignatureApp && window.EmailSignatureApp.DownloadButtons) {
                DEBUG.info('Using EmailSignatureApp.DownloadButtons module');
                window.EmailSignatureApp.DownloadButtons.initializeSignatureDownload(true);
            } else if (typeof window.initializeSignatureDownloadButtons === 'function') {
                DEBUG.info('Using global initializeSignatureDownloadButtons function');
                window.initializeSignatureDownloadButtons(true);
            } else {
                console.warn('Download buttons module not found, will try again later');
                setTimeout(initializeDownloadButtons, 1000);
            }
            return;
        }
        
        downloadButtons.forEach(button => {
            button.addEventListener('click', function() {
                const format = this.getAttribute('data-format') || 'html';
                
                // Get the active signature
                let activeSignature = null;
                
                // Look for the visible signature container
                document.querySelectorAll('[id$="-signature-container"]').forEach(container => {
                    if (container.style.display !== 'none' && container.querySelector('.signature')) {
                        activeSignature = container.querySelector('.signature');
                    }
                });
                
                if (!activeSignature) {
                    console.error('No active signature found for download');
                    alert('No signature found to download. Please refresh the page and try again.');
                    return;
                }
                
                DEBUG.info(`Downloading signature in ${format} format`, activeSignature);
                
                // Try to use the new module structure
        
                // First make sure there's a download button attached to the signature
                window.EmailSignatureApp.DownloadButtons.initializeSignatureDownload(false); // Don't force reinit
                
                // Find the download button and trigger it
                const downloadButton = activeSignature.parentNode.querySelector('.download-button');
                if (downloadButton) {
                    downloadButton.click();
                } else {
                    console.error('Download button not found for active signature');
                    alert('Unable to download the signature. Please try again.');
                }
                
            });
        });
        
        DEBUG.info('Download buttons initialized');
    } catch (error) {
        console.error('Error initializing download buttons:', error);
    }
}

/**
 * Load default template with a delay to ensure EmailSignatureApp is ready
 */
function loadTemplate(templateName) {
    DEBUG.info(`Loading template: ${templateName}`);
    
    // Hide all template containers
    document.querySelectorAll('[id$="-signature-container"]').forEach(container => {
        container.style.display = 'none';
    });
    
    // Show the selected template container
    const templateContainer = document.getElementById(`${templateName}-signature-container`);
    if (!templateContainer) {
        console.error(`Template container for ${templateName} not found`);
        return;
    }
    
    templateContainer.style.display = 'block';
    
    // Load the template
    
        window.EmailSignatureApp.loadTemplate(templateName, templateContainer.id);
        
        // Update signatures after template is loaded
        setTimeout(() => {
            updateSignatures();
            
            // Reinitialize download functionality
            if (window.EmailSignatureApp && window.EmailSignatureApp.DownloadButtons) {
                window.EmailSignatureApp.DownloadButtons.initializeSignatureDownload(true); // Force reinit since we just changed templates
            }
            
            // Also reinitialize download buttons
            initializeDownloadButtons();
        }, 500);
   
    
    // Update template selector if available
    if (typeof window.updateSelectedTemplate === 'function') {
        window.updateSelectedTemplate(templateName);
    }
    
    // Update active template button
    document.querySelectorAll('.template-button').forEach(button => {
        if (button.getAttribute('data-template') === templateName) {
            button.classList.add('active');
        } else {
            button.classList.remove('active');
        }
    });
}

function updateColorPreview(colorInput) {
    try {
        if (!colorInput) {
            console.error('Color input is null or undefined');
            return;
        }
        
        const colorValue = colorInput.value;
        DEBUG.info(`Updating color preview for ${colorInput.id} with value ${colorValue}`);
        
        // Find the preview box that corresponds to this color input
        const previewBoxId = colorInput.id + '-preview';
        const previewBox = document.getElementById(previewBoxId);
        
        if (previewBox) {
            // Update the background color of the preview box
            previewBox.style.backgroundColor = colorValue;
            DEBUG.info(`Updated preview box ${previewBoxId} with color ${colorValue}`);
        } else {
            // Try to find it by proximity (next sibling)
            const parentContainer = colorInput.closest('.color-input-container');
            if (parentContainer) {
                const previewBoxInContainer = parentContainer.querySelector('.color-preview');
                if (previewBoxInContainer) {
                    previewBoxInContainer.style.backgroundColor = colorValue;
                    DEBUG.info(`Updated nearby preview box with color ${colorValue}`);
                }
            }
        }
        
        // Save to localStorage
        const isDarkMode = localStorage.getItem('signature-dark-mode') === 'true';
        const mode = isDarkMode ? 'dark' : 'light';
        
        // Extract color type from input ID: input-primary-color -> primary
        const colorType = colorInput.id.replace('input-', '').replace('-color', '');
        
        // Save to localStorage with the current mode
        const storageKey = `signature-${colorType}-color-${mode}`;
        localStorage.setItem(storageKey, colorValue);
        DEBUG.info(`Saved ${colorValue} to ${storageKey}`);
        
    } catch (error) {
        console.error('Error updating color preview:', error);
    }
}

function updateSignatureColors() {
    // Get color values
    const mode = localStorage.getItem('signature-dark-mode') === 'true' ? 'dark' : 'light';
    const primaryColor = localStorage.getItem(`signature-primary-color-${mode}`) || CONFIG.colors[mode].primary;
    const secondaryColor = localStorage.getItem(`signature-secondary-color-${mode}`) || CONFIG.colors[mode].secondary;
    const accentColor = localStorage.getItem(`signature-accent-color-${mode}`) || CONFIG.colors[mode].accent;
    const backgroundColor = localStorage.getItem(`signature-background-color-${mode}`) || CONFIG.colors[mode].background;
    
    DEBUG.info(`Updating signature colors for ${mode} mode:`, { primaryColor, secondaryColor, accentColor, backgroundColor });
    
    // Apply primary color to name elements
    document.querySelectorAll('.signature .name').forEach(element => {
        element.style.color = primaryColor;
    });
    
    // Apply secondary color to title and contact elements
    document.querySelectorAll('.signature .title, .signature .contact').forEach(element => {
        element.style.color = secondaryColor;
    });
    
    // Apply accent color to links, highlights, and company names
    document.querySelectorAll('.signature a, .signature .highlight, .signature .company-name').forEach(element => {
        element.style.color = accentColor;
    });
    
    // Apply accent color to border elements
    document.querySelectorAll('.signature table td[style*="border-left"]').forEach(element => {
        element.style.borderLeftColor = accentColor;
    });
    
    // Apply accent color to SVG icons
    document.querySelectorAll('.signature svg').forEach(element => {
        if (element.getAttribute('fill') && element.getAttribute('fill').includes('var(--accent-color)')) {
            element.setAttribute('fill', accentColor);
        }
    });
    
    // Update CSS variables
    document.documentElement.style.setProperty('--accent-color', accentColor);
    document.documentElement.style.setProperty('--primary-color', primaryColor);
    document.documentElement.style.setProperty('--secondary-color', secondaryColor);
    document.documentElement.style.setProperty('--background-color', backgroundColor);
    
    // Apply background color to signature backgrounds
    document.querySelectorAll('.signature').forEach(element => {
        element.style.backgroundColor = backgroundColor;
    });
    
    // If we have the social icons module, update social icons with the new colors
    if (window.EmailSignatureApp && window.EmailSignatureApp.SocialIcons && 
        typeof window.EmailSignatureApp.SocialIcons.applyBrandColors === 'function') {
        window.EmailSignatureApp.SocialIcons.applyBrandColors();
    }
}
