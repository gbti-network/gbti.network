/**
 * Social Icons Manager
 * This module handles all social icon related functionality for email signatures
 */

// Use the global namespace
window.EmailSignatureApp = window.EmailSignatureApp || {};

// Create the social icons module
(function(app) {
    'use strict';
    
    // Private variables
    const _module = {};
    
    /**
     * Icon path helper function - resolves paths to social media icons
     * @param {string} iconPath - Relative path to the icon
     * @returns {string} - Full resolved path to the icon
     */
    _module.resolveIconPath = function(iconPath) {
        // Check if we're in WordPress environment
        if (typeof EmailSignatureGeneratorConfig !== 'undefined' && EmailSignatureGeneratorConfig.isWordPress) {
            // Prepend the tool base URL to the icon path
            return EmailSignatureGeneratorConfig.toolBaseUrl + iconPath;
        }
        
        // Return original path in non-WordPress environment
        return iconPath;
    };
    
    /**
     * Initialize the social icons module
     * Sets up event listeners and initializes the icons
     */
    _module.initialize = function() {
        DEBUG.info('Initializing social icons module');
        
        // Setup event listeners for signature updates
        _module._setupEventListeners();
        
        // Apply brand colors to any existing icons
        _module.applyBrandColors();
        
        // Initialize hover effects
        _module.initializeSocialIconEffects();
        
        // Check if dark mode is enabled on initialization through the DarkMode module
        if (window.EmailSignatureApp && window.EmailSignatureApp.DarkMode) {
            const isDarkMode = window.EmailSignatureApp.DarkMode.isDarkMode();
            if (isDarkMode) {
                _module.updateSocialIconsForDarkMode(true);
            }
        } else {
            // Fallback to localStorage check if DarkMode module is not available
            const isDarkMode = localStorage.getItem('signature-dark-mode') === 'true';
            if (isDarkMode) {
                _module.updateSocialIconsForDarkMode(true);
            }
        }
        
        // Listen for dark mode changes
        document.addEventListener('darkModeChanged', function(event) {
            if (event.detail && typeof event.detail.isDarkMode === 'boolean') {
                DEBUG.info('Dark mode changed event received in social-icons.js', event.detail);
                _module.updateSocialIconsForDarkMode(event.detail.isDarkMode);
            }
        });
        
        // Listen for template loaded events
        if (window.EmailSignatureApp && window.EmailSignatureApp.addEventListener) {
            window.EmailSignatureApp.addEventListener('templateLoaded', _module.applyBrandColors);
        }
        
        // Run verification (moved from verify-social-icons.js)
        setTimeout(function() {
            _module.verifySocialIcons();
        }, 1000);
        
        DEBUG.info('Social icons module initialized');
    };
    
    /**
     * Set up event listeners for social icon updates
     * @private
     */
    function _setupEventListeners() {
        // Listen for custom socialIconsUpdated event
        document.addEventListener('socialIconsUpdated', function(event) {
            DEBUG.info('Social icons updated event received');
            
            // Call updateSocialIcons which will refresh all icons
            if (typeof _module.updateSocialIcons === 'function') {
                setTimeout(() => _module.updateSocialIcons(), 50);
            }
            
            // Apply brand colors
            setTimeout(_module.applyBrandColors, 100);
        });
        
        // Create a MutationObserver to watch for changes to the DOM
        const observer = new MutationObserver(function(mutations) {
            mutations.forEach(function(mutation) {
                if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                    // Check if any social icons were added
                    const hasNewIcons = Array.from(mutation.addedNodes).some(node => {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            return node.classList?.contains('social-icon') || 
                                   node.querySelector?.('.social-icon');
                        }
                        return false;
                    });
                    
                    if (hasNewIcons) {
                        _module.applyBrandColors();
                    }
                }
            });
        });
        
        // Start observing the document body
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }
    
    /**
     * Apply brand colors to all social icons
     */
    _module.applyBrandColors = function() {
        DEBUG.info('Applying brand colors to social icons...');
        
        // Get all social icon images
        const socialIcons = document.querySelectorAll('.social-icon');
        
        // Apply platform-specific classes
        socialIcons.forEach(icon => {
            const platform = icon.getAttribute('alt')?.split(' ')[0] || '';
            if (platform) {
                // Add the platform-specific class
                icon.classList.add(`${platform}-icon`);
            }
        });
        
        DEBUG.info(`Applied brand colors to ${socialIcons.length} icons`);
    };
    
    /**
     * Initialize hover effects for social icons
     */
    _module.initializeSocialIconEffects = function() {
        const socialIcons = document.querySelectorAll('.social-icon');
        socialIcons.forEach(icon => {
            icon.addEventListener('mouseover', function() {
                this.style.transform = 'scale(1.2)';
            });
            
            icon.addEventListener('mouseout', function() {
                this.style.transform = 'scale(1)';
            });
        });
    };
    
    /**
     * Update social icons in all signatures
     */
    _module.updateSocialIcons = function() {
        try {
            DEBUG.info('Updating social icons');
            
            // Get social icons from social media repeater or fallback
            const icons = _module.getSocialIcons();
            DEBUG.info('Got social icons:', icons);
            
            // Find all social icons containers in all signatures
            const containers = document.querySelectorAll('.sig-social-icons');
            DEBUG.info('Found social icon containers:', containers.length);
            
            if (containers.length === 0) {
                console.warn('No social icons containers found in templates');
                return;
            }
            
            // Process each container
            containers.forEach(container => {
                // Store the existing container's parent for later reference
                const parent = container.parentNode;
                
                // Create a new container to replace the old one
                const newContainer = container.cloneNode(false);
                
                // Add icons based on the icons array
                if (icons && Array.isArray(icons) && icons.length > 0) {
                    icons.forEach(icon => {
                        if (icon && (icon.platform || icon.type)) {
                            const platform = icon.platform || icon.type;
                            const url = icon.url || icon.link;
                            
                            if (platform && url) {
                                //DEBUG.info('Adding icon:', platform, url);
                                
                                const link = document.createElement('a');
                                
                                // Special handling for email
                                if (platform === 'email') {
                                    link.href = `mailto:${url}`;
                                } else {
                                    // Make sure URL has protocol
                                    if (!url.startsWith('http://') && !url.startsWith('https://') && 
                                        platform !== 'email') {
                                        link.href = `https://${url}`;
                                    } else {
                                        link.href = url;
                                    }
                                }
                                
                                link.target = '_blank';
                                link.rel = 'noopener noreferrer';
                                
                                // Important: Add platform as class to link for proper icon handling
                                link.classList.add(`social-icon-link-${platform}`);
                                
                                const img = document.createElement('img');
                                img.src = _module.resolveIconPath(`assets/icons/${platform}.png`);
                                img.alt = `${platform} icon`;
                                img.className = `social-icon ${platform}-icon`;
                                img.onerror = function() {
                                    console.warn(`Failed to load icon for ${platform}, trying original path`);
                                    this.src = _module.resolveIconPath(`assets/icons/${platform}.png`);
                                    
                                    // Second fallback if the first one fails
                                    this.onerror = function() {
                                        console.warn(`Failed to load icon for ${platform}, using email icon as fallback`);
                                        this.src = _module.resolveIconPath('assets/icons/email.png');
                                    };
                                };
                                
                                link.appendChild(img);
                                newContainer.appendChild(link);
                            }
                        }
                    });
                }
                
                // Replace old container with new container
                if (parent) {
                    parent.replaceChild(newContainer, container);
                }
            });
            
            // Apply brand colors
            setTimeout(() => {
                _module.applyBrandColors();
                DEBUG.info('Social icons update complete');
            }, 50);
            
        } catch (error) {
            console.error('Error updating social icons:', error);
        }
    };
    
    /**
     * Get social icons from social media repeater
     * @returns {Array} Array of icon objects with platform and url properties
     */
    _module.getSocialIcons = function() {
        DEBUG.info('Getting social icons');
        
        try {
            // Try to get icons from social media repeater if it exists
            if (window.socialMediaRepeater && typeof window.socialMediaRepeater.getIcons === 'function') {
                const icons = window.socialMediaRepeater.getIcons();
                DEBUG.info('Got icons from socialMediaRepeater:', icons);
                
                // Map to ensure consistent property names
                if (icons && icons.length > 0) {
                    return icons.map(icon => ({
                        platform: icon.platform || icon.type,
                        url: icon.url || icon.link
                    }));
                }
            }
            
            // Fallback for backward compatibility or if repeater doesn't exist
            const icons = [];
            const repeaterContainer = document.getElementById('social-media-repeater');
            
            if (repeaterContainer) {
                // Try to get icons from the DOM
                const items = repeaterContainer.querySelectorAll('.social-media-item');
                items.forEach(item => {
                    const platformSelect = item.querySelector('.social-media-platform');
                    const urlInput = item.querySelector('.social-media-url');
                    
                    if (platformSelect && urlInput && platformSelect.value && urlInput.value) {
                        icons.push({
                            platform: platformSelect.value,
                            url: urlInput.value
                        });
                    }
                });
                
                DEBUG.info('Got icons from repeater DOM:', icons);
                
                // If we got icons, return them
                if (icons.length > 0) {
                    return icons;
                }
            }
            
            // If still empty, use default icons
            return [
                { platform: 'linkedin', url: app.getInputValue ? app.getInputValue('input-linkedin') : document.getElementById('input-linkedin')?.value || 'https://www.linkedin.com/in/gbti_network/' },
                { platform: 'x', url: app.getInputValue ? app.getInputValue('input-x') : document.getElementById('input-x')?.value || 'https://x.com/gbti_network' },
                { platform: 'github', url: app.getInputValue ? app.getInputValue('input-github') : document.getElementById('input-github')?.value || 'https://github.com/gbti_network' },
                { platform: 'email', url: app.getInputValue ? app.getInputValue('input-email') : document.getElementById('input-email')?.value || 'opportunities@gbti.network' },
                { platform: 'calendly', url: app.getInputValue ? app.getInputValue('input-calendly') : document.getElementById('input-calendly')?.value || 'https://calendly.com/gbti_network/15min' }
            ];
        } catch (error) {
            console.error('Error getting social icons:', error);
            
            // Ultimate fallback - return basic set
            return [
                { platform: 'linkedin', url: 'https://www.linkedin.com/in/gbti_network/' },
                { platform: 'x', url: 'https://x.com/gbti_network' },
                { platform: 'github', url: 'https://github.com/gbti_network' }
            ];
        }
    };
    
    /**
     * Add a social icon to all signature social containers
     * @param {string} platform - Social media platform 
     * @param {string} url - URL for the social media link
     */
    _module.addSocialIconToSignatures = function(platform, url) {
        try {
            // Get all social icon containers
            const containers = document.querySelectorAll('.sig-social-icons');
            
            containers.forEach(container => {
                // Create link
                const link = document.createElement('a');
                link.href = url.startsWith('http') ? url : (platform === 'email' ? `mailto:${url}` : `https://${url}`);
                link.target = '_blank';
                link.rel = 'noopener noreferrer';
                
                // Important: Add platform as class to link for proper icon handling
                link.classList.add(`social-icon-link-${platform}`);
                
                // Special handling for Calendly links
                if (platform === 'calendly') {
                    link.classList.add('calendly');
                }
                
                const img = document.createElement('img');
                img.src = _module.resolveIconPath(`assets/icons/${platform}.png`);
                img.alt = `${platform} icon`;
                img.className = 'social-icon';
                
                link.appendChild(img);
                container.appendChild(link);
            });
            
            // Apply brand colors after adding icons
            _module.applyBrandColors();
            
        } catch (error) {
            console.error(`Error adding social icon for ${platform}:`, error);
        }
    };
    
    /**
     * Update social icons for dark mode
     * @param {boolean} isDarkMode - Whether dark mode is enabled
     */
    _module.updateSocialIconsForDarkMode = function(isDarkMode) {
        const socialIcons = document.querySelectorAll('.social-icon');
        socialIcons.forEach(icon => {
            if (isDarkMode) {
                icon.classList.add('dark-mode');
            } else {
                icon.classList.remove('dark-mode');
            }
        });
        
        // Ensure animated social icons are properly styled in dark mode
        if (isDarkMode) {
            document.querySelectorAll('.animated-social .social-icon').forEach(icon => {
                icon.style.opacity = '0.8';
            });
        } else {
            document.querySelectorAll('.animated-social .social-icon').forEach(icon => {
                icon.style.opacity = '';
            });
        }
    };
    
    /**
     * Debug social icons to help identify and fix issues
     */
    _module.debugSocialIcons = function() {
        console.group('Social Icons Debug Info');
        
        // Check for social icon containers
        const containers = document.querySelectorAll('.sig-social-icons');
        DEBUG.info(`Found ${containers.length} social icon containers`);
        
        // Check for social icons
        const icons = document.querySelectorAll('.social-icon');
        DEBUG.info(`Found ${icons.length} social icons`);
        
        // Log details about each icon
        icons.forEach((icon, index) => {
            console.group(`Icon #${index + 1}`);
            DEBUG.info('Alt text:', icon.getAttribute('alt'));
            DEBUG.info('Source:', icon.getAttribute('src'));
            DEBUG.info('Classes:', icon.className);
            DEBUG.info('Parent:', icon.parentElement.tagName);
            DEBUG.info('Parent href:', icon.parentElement.getAttribute('href'));
            console.groupEnd();
        });
        
        // Check for missing icons
        const missingIcons = Array.from(icons).filter(icon => {
            return !icon.complete || icon.naturalWidth === 0;
        });
        DEBUG.info(`Found ${missingIcons.length} missing or broken icons`);
        
        console.groupEnd();
        
        return {
            containers: containers.length,
            icons: icons.length,
            missing: missingIcons.length
        };
    };
    
    /**
     * Verify that social icons are properly configured
     * Moved from verify-social-icons.js
     */
    _module.verifySocialIcons = function() {
        DEBUG.info('Verifying social icon integration...');
        
        // Check that the icons directory exists
        const iconPath = 'assets/icons/';
        const testImage = new Image();
        testImage.onload = function() {
            DEBUG.info('Icons directory is accessible');
            continueVerification();
        };
        testImage.onerror = function() {
            console.error('Icons directory is not accessible');
        };
        testImage.src = _module.resolveIconPath(`${iconPath}linkedin.png`);
        
        function continueVerification() {
            
            // Check that social icons have platform-specific classes
            const socialIcons = document.querySelectorAll('.social-icon');
            if (socialIcons.length > 0) {
                DEBUG.info(`Found ${socialIcons.length} social icons`);
                
                let allHavePlatformClass = true;
                socialIcons.forEach(icon => {
                    const classList = Array.from(icon.classList);
                    const hasPlatformClass = classList.some(cls => cls.endsWith('-icon') && cls !== 'social-icon');
                    
                    if (!hasPlatformClass) {
                        console.error(`Icon missing platform-specific class: ${icon.outerHTML}`);
                        allHavePlatformClass = false;
                    }
                });
                
                if (allHavePlatformClass) {
                    DEBUG.info('All icons have platform-specific classes');
                }
            } else {
                console.warn('No social icons found in the document');
            }
            
            DEBUG.info('Social icon verification complete');
        }
    };
    
    // Export functions to the EmailSignatureApp namespace
    window.EmailSignatureApp.SocialIcons = {
        applyBrandColors: _module.applyBrandColors,
        updateSocialIcons: _module.updateSocialIcons,
        updateSocialIconsForDarkMode: _module.updateSocialIconsForDarkMode,
        debugSocialIcons: _module.debugSocialIcons,
        getSocialIcons: _module.getSocialIcons,
        addSocialIconToSignatures: _module.addSocialIconToSignatures,
        verifySocialIcons: _module.verifySocialIcons,
        initialize: _module.initialize
    };
    
    // Export functions to the global namespace for backward compatibility
    window.applyBrandColors = _module.applyBrandColors;
    window.updateSocialIcons = _module.updateSocialIcons;
    window.updateSocialIconsForDarkMode = _module.updateSocialIconsForDarkMode;
    window.debugSocialIcons = _module.debugSocialIcons;
    window.getSocialIcons = _module.getSocialIcons;
    window.addSocialIconToSignatures = _module.addSocialIconToSignatures;
    window.verifySocialIcons = _module.verifySocialIcons;
    
})(window.EmailSignatureApp);

// For CommonJS compatibility
if (typeof module !== 'undefined' && module.exports) {
    module.exports = window.EmailSignatureApp.SocialIcons;
}