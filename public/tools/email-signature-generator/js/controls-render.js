/**
 * Part two of controls.js (the 900-line limit): social icons, colors, template loading and border radius.
 * A classic script like controls.js, loaded directly after it, so every function stays global and is defined
 * before DOMContentLoaded runs init().
 */

/**
 * Listen for custom socialIconsUpdated event as a fallback
 */
document.addEventListener('socialIconsUpdated', function(event) {
    // Check if this event should trigger an update
    if (event.detail && event.detail.skipSignatureUpdate) {
        DEBUG.info('Social icons updated event received, but skipping signature update as requested');
        return;
    }
    
    DEBUG.info('Social icons updated event received, updating signatures');
    updateSignatures();
});

/**
 * Update social icons legacy fallback
 */
function updateSocialIcons() {
    console.warn('Using legacy updateSocialIcons function - consider upgrading to the SocialIcons module');
    
    // Get all social icon containers
    const socialIconContainers = document.querySelectorAll('.sig-social-icons, .icon-row');
    
    if (socialIconContainers.length === 0) {
        console.warn('No social icon containers found');
        return;
    }
    
    // Get active social links from form inputs or localStorage
    const socialLinks = [];
    
    // Look for social media repeater
    const repeater = document.getElementById('social-media-repeater');
    if (repeater) {
        // Get all social media input groups
        const socialMediaGroups = repeater.querySelectorAll('.social-media-input-group');
        
        socialMediaGroups.forEach(group => {
            const selectElement = group.querySelector('select');
            const inputElement = group.querySelector('input[type="text"], input[type="url"]');
            
            if (selectElement && inputElement && inputElement.value.trim() !== '') {
                const platform = selectElement.value;
                const url = inputElement.value.trim();
                
                socialLinks.push({
                    platform: platform,
                    url: url
                });
            }
        });
    }
    
    // Fallback to localStorage if repeater is empty or not found
    if (socialLinks.length === 0) {
        // Try to load from localStorage
        const savedSocialIcons = localStorage.getItem('socialIcons');
        if (savedSocialIcons) {
            try {
                const parsedIcons = JSON.parse(savedSocialIcons);
                if (Array.isArray(parsedIcons) && parsedIcons.length > 0) {
                    parsedIcons.forEach(icon => {
                        if (icon.platform && icon.url) {
                            socialLinks.push(icon);
                        }
                    });
                }
            } catch (error) {
                console.error('Error parsing saved social icons:', error);
            }
        }
    }
    
    // Add icons to all containers
    if (socialLinks.length > 0) {
        socialIconContainers.forEach(container => {
            // Create a new container to replace the old one
            const parent = container.parentNode;
            const newContainer = container.cloneNode(false);
            
            socialLinks.forEach(link => {
                const icon = createSocialIcon(link.platform, link.url);
                if (icon) {
                    newContainer.appendChild(icon);
                }
            });
            
            // Replace old container with new one
            if (parent) {
                parent.replaceChild(newContainer, container);
            }
        });
        
        DEBUG.info(`Added ${socialLinks.length} social icons to ${socialIconContainers.length} containers`);
    } else {
        DEBUG.info('No social links found to add');
    }
    
    // Apply brand colors to ensure styling is consistent
    if (typeof window.EmailSignatureApp?.SocialIcons?.applyBrandColors === 'function') {
        setTimeout(() => window.EmailSignatureApp.SocialIcons.applyBrandColors(), 50);
    }
}

/**
 * @returns {HTMLElement|null} null when platform or url is missing, or when construction throws.
 * An UNRECOGNISED platform is not a failure: it still renders, with the generic icon.
 */
function createSocialIcon(platform, url) {
    try {
        if (!platform || !url) {
            return null;
        }
        
        // Create link element
        const link = document.createElement('a');
        link.href = url;
        link.target = '_blank';
        link.className = 'social-icon';
        link.setAttribute('data-platform', platform.toLowerCase());
        
        // Create SVG element
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.classList.add('icon');
        
        // Set attributes based on platform
        switch (platform.toLowerCase()) {
            case 'linkedin':
                setupSvgIcon(svg, 'M0 1.146C0 .513.526 0 1.175 0h13.65C15.474 0 16 .513 16 1.146v13.708c0 .633-.526 1.146-1.175 1.146H1.175C.526 16 0 15.487 0 14.854V1.146zm4.943 12.248V6.169H2.542v7.225h2.401zm-1.2-8.212c.837 0 1.358-.554 1.358-1.248-.015-.709-.52-1.248-1.342-1.248-.822 0-1.359.54-1.359 1.248 0 .694.521 1.248 1.327 1.248h.016zm4.908 8.212V9.359c0-.216.016-.432.08-.586.173-.431.568-.878 1.232-.878.869 0 1.216.662 1.216 1.634v3.865h2.401V9.25c0-2.22-1.184-3.252-2.764-3.252-1.274 0-1.845.7-2.165 1.193v.025h-.016a5.54 5.54 0 0 1 .016-.025V6.169h-2.4c.03.678 0 7.225 0 7.225h2.4z');
                break;
            case 'x':
            case 'x':
                setupSvgIcon(svg, 'M5.026 15c6.038 0 9.341-5.003 9.341-9.334 0-.14 0-.282-.006-.422A6.685 6.685 0 0 0 16 3.542a6.658 6.658 0 0 1-1.889.518 3.301 3.301 0 0 0 1.447-1.817 6.533 6.533 0 0 1-2.087.793A3.286 3.286 0 0 0 7.875 6.03a9.325 9.325 0 0 1-6.767-3.429 3.289 3.289 0 0 0 1.018 4.382A3.323 3.323 0 0 1 .64 6.575v.045a3.288 3.288 0 0 0 2.632 3.218 3.203 3.203 0 0 1-.865.115 3.23 3.23 0 0 1-.614-.057 3.283 3.283 0 0 0 3.067 2.277A6.588 6.588 0 0 1 .78 13.58a6.32 6.32 0 0 1-.78-.045A9.344 9.344 0 0 0 5.026 15z');
                break;
            case 'facebook':
                setupSvgIcon(svg, 'M16 8.049c0-4.446-3.582-8.05-8-8.05C3.58 0 0 3.58 0 8c0 4.017 2.926 7.347 6.75 7.951v-5.625h-2.03V8.05H6.75V6.275c0-2.017 1.195-3.131 3.022-3.131.876 0 1.791.157 1.791.157v1.98h-1.009c-.993 0-1.303.621-1.303 1.258v1.51h2.218l-.354 2.326H9.25V16c3.824-.604 6.75-3.934 6.75-7.951z');
                break;
            case 'instagram':
                setupSvgIcon(svg, 'M8.051 1.999h.089c.822.003 4.987.033 6.11.335a2.01 2.01 0 0 1 1.415 1.42c.101.38.172.883.22 1.402l.01.104.022.26.008.104c.065.914.073 1.77.074 1.957v.075c-.001.194-.01 1.108-.082 2.06l-.008.105-.009.104c-.05.572-.124 1.14-.235 1.558a2.007 2.007 0 0 1-1.415 1.42c-1.16.312-5.569.334-6.18.335h-.142c-.309 0-1.587-.006-2.927-.052l-.17-.006-.087-.004-.171-.007-.171-.007c-1.11-.049-2.167-.128-2.654-.26a2.007 2.007 0 0 1-1.415-1.419c-.111-.417-.185-.986-.235-1.558L.09 9.82l-.008-.104A31.4 31.4 0 0 1 0 7.68v-.123c.002-.215.01-.958.064-1.778l.007-.103.003-.052.008-.104.022-.26.01-.104c.048-.519.119-1.023.22-1.402a2.007 2.007 0 0 1 1.415-1.42c.487-.13 1.544-.21 2.654-.26l.17-.007.172-.006.086-.003.171-.007A99.788 99.788 0 0 1 7.858 2h.193zM6.4 5.209v4.818l4.157-2.408L6.4 5.209z');
                break;
            case 'github':
                setupSvgIcon(svg, 'M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.012 8.012 0 0 0 16 8c0-4.42-3.58-8-8-8z');
                break;
            case 'youtube':
                setupSvgIcon(svg, 'M8.051 1.999h.089c.822.003 4.987.033 6.11.335a2.01 2.01 0 0 1 1.415 1.42c.101.38.172.883.22 1.402l.01.104.022.26.008.104c.065.914.073 1.77.074 1.957v.075c-.001.194-.01 1.108-.082 2.06l-.008.105-.009.104c-.05.572-.124 1.14-.235 1.558a2.007 2.007 0 0 1-1.415 1.42c-1.16.312-5.569.334-6.18.335h-.142c-.309 0-1.587-.006-2.927-.052l-.17-.006-.087-.004-.171-.007-.171-.007c-1.11-.049-2.167-.128-2.654-.26a2.007 2.007 0 0 1-1.415-1.419c-.111-.417-.185-.986-.235-1.558L.09 9.82l-.008-.104A31.4 31.4 0 0 1 0 7.68v-.123c.002-.215.01-.958.064-1.778l.007-.103.003-.052.008-.104.022-.26.01-.104c.048-.519.119-1.023.22-1.402a2.007 2.007 0 0 1 1.415-1.42c.487-.13 1.544-.21 2.654-.26l.17-.007.172-.006.086-.003.171-.007A99.788 99.788 0 0 1 7.858 2h.193zM6.4 5.209v4.818l4.157-2.408L6.4 5.209z');
                break;
            // Add more platforms as needed
            default:
                // Generic icon for other platforms
                setupSvgIcon(svg, 'M8 0C3.58 0 0 3.58 0 8s3.58 8 8 8 8-3.58 8-8-3.58-8-8-8zm.5 12.5c.55 0 1-.45 1-1v-4h3.5c.55 0 1-.45 1-1s-.45-1-1-1h-3.5v-1c0-.55-.45-1-1-1s-1 .45-1 1V10h-3.5c-.55 0-1 .45-1 1s.45 1 1 1h3.5v.5c0 .55.45 1 1 1z');
                break;
        }
        
        // Add icon to link
        link.appendChild(svg);
        
        return link;
    } catch (error) {
        console.error('Error creating social icon:', error);
        return null;
    }
}

function setupSvgIcon(svg, pathData) {
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('fill', 'currentColor');
    svg.setAttribute('width', '16');
    svg.setAttribute('height', '16');
    
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', pathData);
    svg.appendChild(path);
}

function applyColors() {
    const isDarkMode = localStorage.getItem('signature-dark-mode') === 'true';
    const mode = isDarkMode ? 'dark' : 'light';
    
    DEBUG.info(`Applying colors for ${mode} mode`);
    
    // Save colors to localStorage
    localStorage.setItem(`signature-primary-color-${mode}`, document.getElementById('input-primary-color').value);
    localStorage.setItem(`signature-secondary-color-${mode}`, document.getElementById('input-secondary-color').value);
    localStorage.setItem(`signature-accent-color-${mode}`, document.getElementById('input-accent-color').value);
    localStorage.setItem(`signature-background-color-${mode}`, document.getElementById('input-background-color').value);
    
    // Apply colors to CSS variables
    document.documentElement.style.setProperty(`--${mode}-primary-color`, document.getElementById('input-primary-color').value);
    document.documentElement.style.setProperty(`--${mode}-secondary-color`, document.getElementById('input-secondary-color').value);
    document.documentElement.style.setProperty(`--${mode}-accent-color`, document.getElementById('input-accent-color').value);
    document.documentElement.style.setProperty(`--${mode}-background-color`, document.getElementById('input-background-color').value);
    
    DEBUG.info('Applied colors for mode:', mode, {
        primary: document.getElementById('input-primary-color').value,
        secondary: document.getElementById('input-secondary-color').value,
        accent: document.getElementById('input-accent-color').value,
        background: document.getElementById('input-background-color').value
    });
}

EmailSignatureApp.loadTemplate = function(templateName, containerId) {
    DEBUG.info(`Loading template: ${templateName}`);
    DEBUG.info(`Registered templates:`);
    DEBUG.info(this.templates);
    
    // Get the template - use getTemplate method instead of direct array access
    const template = this.getTemplate(templateName);
    if (!template) {
        console.error(`Template not found: ${templateName}`);
        return;
    }
    
    // Update the current template
    this.currentTemplate = templateName;
    
    // Clear the template container
    const container = document.getElementById(containerId);
    container.innerHTML = '';
    
    // Remove any existing template CSS
    const existingTemplateCss = document.querySelector('link[data-template-css]');
    if (existingTemplateCss) {
        existingTemplateCss.remove();
    }
    
    // Add the template CSS
    if (template.paths && template.paths.css) {
        const cssLink = document.createElement('link');
        cssLink.setAttribute('rel', 'stylesheet');
        cssLink.setAttribute('type', 'text/css');
        cssLink.setAttribute('data-template-css', templateName);
        
        // Add version parameter to prevent caching
        let cssUrl = template.paths.css;
        
        // If we're in WordPress, use the theme version from the localized data
        if (typeof EmailSignatureGeneratorConfig !== 'undefined' && EmailSignatureGeneratorConfig.themeVersion) {
            cssUrl = cssUrl + '?ver=' + EmailSignatureGeneratorConfig.themeVersion;
        } else {
            // Fallback to timestamp for non-WordPress environments
            cssUrl = cssUrl + '?ver=' + new Date().getTime();
        }
        
        cssLink.setAttribute('href', cssUrl);
        document.head.appendChild(cssLink);
        DEBUG.info(`Loaded CSS with version: ${cssUrl}`);
    }
    
    // Load the template HTML
    if (template.paths && template.paths.html) {
        const htmlPath = template.paths.html;
        
        // Add version parameter to prevent caching
        let htmlUrl = htmlPath;
        
        // If we're in WordPress, use the theme version from the localized data
        if (typeof EmailSignatureGeneratorConfig !== 'undefined' && EmailSignatureGeneratorConfig.themeVersion) {
            htmlUrl = htmlUrl + '?ver=' + EmailSignatureGeneratorConfig.themeVersion;
        } else {
            // Fallback to timestamp for non-WordPress environments
            htmlUrl = htmlUrl + '?ver=' + new Date().getTime();
        }
        
        DEBUG.info(`Loading HTML with version: ${htmlUrl}`);
        
        fetch(htmlUrl)
            .then(response => {
                if (!response.ok) {
                    throw new Error(`Failed to load template HTML: ${response.status} ${response.statusText}`);
                }
                return response.text();
            })
            .then(html => {
                // Process HTML for additional path fixes if in WordPress
                if (typeof EmailSignatureGeneratorConfig !== 'undefined' && EmailSignatureGeneratorConfig.isWordPress) {
                    html = this.processTemplateHtml(html, templateName);
                }
                
                // Set the HTML content
                container.innerHTML = html;
                
                // Give the browser a moment to parse the HTML content before initializing
                setTimeout(() => {
                    // Initialize the template
                    if (typeof template.initialize === 'function') {
                        try {
                            template.initialize(container);
                        } catch (initError) {
                            console.error('Error initializing template:', initError);
                        }
                    }
                    
                    // Update the template selector
                    const templateSelector = document.getElementById('template-selector');
                    if (templateSelector) {
                        templateSelector.value = templateName;
                    }
                    
                    // Trigger a template loaded event
                    const event = new CustomEvent('template-loaded', { detail: { templateName: templateName } });
                    document.dispatchEvent(event);
                    
                    DEBUG.info(`Template loaded: ${templateName}`);
                }, 0);
            })
            .catch(error => {
                console.error('Error loading template:', error);
                container.innerHTML = `<div class="error">Error loading template: ${error.message}</div>`;
            });
    }
};

EmailSignatureApp.processTemplateHtml = function(html, templateName) {
    DEBUG.info(`Processing template HTML for: ${templateName}`);
    
    // Create temporary element to parse HTML
    var tempDiv = document.createElement('div');
    tempDiv.innerHTML = html;
    
    // Process all elements with URLs
    var processElement = function(element) {
        // Process src attributes
        if (element.hasAttribute('src')) {
            var src = element.getAttribute('src');
            if (!src.startsWith('http') && !src.startsWith('data:') && !src.startsWith('/')) {
                // Check if it's a relative path to the template directory
                if (src.startsWith('./') || !src.includes('/')) {
                    // It's a template-specific resource
                    element.setAttribute('src', EmailSignatureGeneratorConfig.templatesPath + templateName + '/html/' + src.replace('./', ''));
                } else if (src.startsWith('../')) {
                    // It's a resource one level up from the template's html directory
                    element.setAttribute('src', EmailSignatureGeneratorConfig.templatesPath + templateName + '/' + src.replace('../', ''));
                } else if (src.startsWith('assets/')) {
                    // It's a resource in the main assets directory
                    element.setAttribute('src', EmailSignatureGeneratorConfig.toolBaseUrl + src);
                }
            }
        }
        
        // Process background images in style attributes
        if (element.hasAttribute('style')) {
            var style = element.getAttribute('style');
            var newStyle = style.replace(/url\(['"]?([^'")]+)['"]?\)/g, function(match, url) {
                if (!url.startsWith('http') && !url.startsWith('data:') && !url.startsWith('/')) {
                    // Check if it's a relative path to the template directory
                    if (url.startsWith('./') || !url.includes('/')) {
                        // It's a template-specific resource
                        return "url('" + EmailSignatureGeneratorConfig.templatesPath + templateName + '/html/' + url.replace('./', '') + "')";
                    } else if (url.startsWith('../')) {
                        // It's a resource one level up from the template's html directory
                        return "url('" + EmailSignatureGeneratorConfig.templatesPath + templateName + '/' + url.replace('../', '') + "')";
                    } else if (url.startsWith('assets/')) {
                        // It's a resource in the main assets directory
                        return "url('" + EmailSignatureGeneratorConfig.toolBaseUrl + url + "')";
                    }
                }
                return match;
            });
            element.setAttribute('style', newStyle);
        }
        
        // Process all children recursively
        Array.from(element.children).forEach(processElement);
    };
    
    // Process the root element
    processElement(tempDiv);
    
    return tempDiv.innerHTML;
};

function initializeBorderRadiusControls() {
    DEBUG.info('Initializing border radius controls');
    
    // Profile image radius control
    const profileRadiusSlider = document.getElementById('profile-radius-slider');
    const profileRadiusValue = document.getElementById('profile-radius-value');
    
    if (profileRadiusSlider && profileRadiusValue) {
        // Load saved value from localStorage or use default
        const savedProfileRadius = localStorage.getItem('profile-radius') || 0;
        profileRadiusSlider.value = savedProfileRadius;
        profileRadiusValue.textContent = savedProfileRadius;
        
        // Apply initial radius
        applyProfileRadius(savedProfileRadius);
        
        // Add event listener for real-time updating
        profileRadiusSlider.addEventListener('input', function() {
            const radius = this.value;
            profileRadiusValue.textContent = radius;
            
            // Save to localStorage
            localStorage.setItem('profile-radius', radius);
            
            // Apply radius
            applyProfileRadius(radius);
        });
    }
    
    // Logo image radius control
    const logoRadiusSlider = document.getElementById('logo-radius-slider');
    const logoRadiusValue = document.getElementById('logo-radius-value');
    
    if (logoRadiusSlider && logoRadiusValue) {
        // Load saved value from localStorage or use default
        const savedLogoRadius = localStorage.getItem('logo-radius') || 0;
        logoRadiusSlider.value = savedLogoRadius;
        logoRadiusValue.textContent = savedLogoRadius;
        
        // Apply initial radius
        applyLogoRadius(savedLogoRadius);
        
        // Add event listener for real-time updating
        logoRadiusSlider.addEventListener('input', function() {
            const radius = this.value;
            logoRadiusValue.textContent = radius;
            
            // Save to localStorage
            localStorage.setItem('logo-radius', radius);
            
            // Apply radius
            applyLogoRadius(radius);
        });
    }
}

/**
 * Apply profile image border radius by dispatching a custom event
 * @param {string|number} radius - Border radius value in pixels
 */
function applyProfileRadius(radius) {
    // Store the value in localStorage
    localStorage.setItem('profile-radius', radius);
    
    // Apply radius to the preview image in the control panel
    const previewImg = document.getElementById('profile-image-preview-img');
    if (previewImg) {
        previewImg.style.borderRadius = radius + 'px';
    }
    
    // Also apply to the preview container for better visibility
    const previewContainer = document.getElementById('profile-image-preview');
    if (previewContainer) {
        previewContainer.style.borderRadius = radius + 'px';
    }
    
    // Dispatch an event that templates can listen for
    const event = new CustomEvent('profileRadiusChanged', {
        detail: { radius: radius + 'px' }
    });
    document.dispatchEvent(event);
    
    DEBUG.info('Applied profile radius:', radius + 'px');
}

/**
 * Apply logo image border radius by dispatching a custom event
 * @param {string|number} radius - Border radius value in pixels
 */
function applyLogoRadius(radius) {
    // Store the value in localStorage
    localStorage.setItem('logo-radius', radius);
    
    // Apply radius to the preview image in the control panel
    const previewImg = document.getElementById('logo-image-preview-img');
    if (previewImg) {
        previewImg.style.borderRadius = radius + 'px';
    }
    
    // Also apply to the preview container for better visibility
    const previewContainer = document.getElementById('logo-image-preview');
    if (previewContainer) {
        previewContainer.style.borderRadius = radius + 'px';
    }
    
    // Dispatch an event that templates can listen for
    const event = new CustomEvent('logoRadiusChanged', {
        detail: { radius: radius + 'px' }
    });
    document.dispatchEvent(event);
    
    DEBUG.info('Applied logo radius:', radius + 'px');
}
