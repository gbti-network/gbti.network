/**
 * Modern Template Registration
 * This file handles the registration and initialization of the modern email signature template
 */

// Register the modern template
(function() {
    // Define the template information
    const modernTemplate = {
        name: 'modern',
        displayName: 'Modern',
        description: 'Contemporary layout with profile image and contact information',
        paths: {
            html: 'templates/modern/html/modern.html',
            css: 'templates/modern/css/modern.css'
        },
        
        /**
         * Initialize the template after it's loaded
         * @param {HTMLElement} container - The container element
         */
        initialize: function(container) {
            DEBUG.info('Initializing modern template');
            
            // Handle empty Calendly URLs
            const calendlyUrl = document.getElementById('input-calendly').value;
            
            if (!calendlyUrl || calendlyUrl.trim() === '') {
                // Find and hide all Calendly-related elements EXCEPT those added via social media
                
                // 1. Find the contact item with Calendly
                const calendlyContactItem = container.querySelector('.contact-item:has(a[href*="calendly"])');
                if (calendlyContactItem) {
                    calendlyContactItem.style.display = 'none';
                }
                
                // 2. Hide Calendly elements with .calendly class that aren't in social icons
                const calendlyElements = container.querySelectorAll('.calendly:not(.social-icon):not(.sig-social-icons a)');
                calendlyElements.forEach(element => {
                    if (!element.closest('.sig-social-icons')) {
                        element.style.display = 'none';
                    }
                });
                
                DEBUG.info('Modern template: Dedicated Calendly elements hidden due to empty URL');
            }
            
            // Add event listeners for Calendly text updates
            const calendlyTextInput = document.getElementById('input-calendly-text');
            if (calendlyTextInput) {
                // Initial update
                updateCalendlyText(container, calendlyTextInput.value);
                
                // Update on input changes
                calendlyTextInput.addEventListener('input', function() {
                    updateCalendlyText(container, this.value);
                });
            }
            
            // Function to update Calendly text
            function updateCalendlyText(container, text) {
                const calendlyTextElements = container.querySelectorAll('.calendly-text');
                calendlyTextElements.forEach(element => {
                    // Only update elements that don't have child elements
                    if (element.childElementCount === 0) {
                        element.textContent = text || CONFIG.defaults.calendlyText;
                    }
                });
            }
            
            // Listen for profile radius change events
            document.addEventListener('profileRadiusChanged', function(e) {
                const radius = e.detail.radius;
                DEBUG.info('Modern template: Applying profile radius:', radius);
                
                // Find all profile images and apply the border radius directly as inline style
                const profileImages = container.querySelectorAll('.profile-img, .profile-image');
                profileImages.forEach(img => {
                    img.style.borderRadius = radius;
                });
            });
            
            // Listen for logo radius change events
            document.addEventListener('logoRadiusChanged', function(e) {
                const radius = e.detail.radius;
                DEBUG.info('Modern template: Applying logo radius:', radius);
                
                // Find all logo images and apply the border radius directly as inline style
                const logoImages = container.querySelectorAll('.company-logo');
                logoImages.forEach(img => {
                    img.style.borderRadius = radius;
                });
            });
            
            // Apply initial radius values from localStorage if available
            const savedProfileRadius = localStorage.getItem('profile-radius');
            if (savedProfileRadius) {
                const profileImages = container.querySelectorAll('.profile-img, .profile-image');
                profileImages.forEach(img => {
                    img.style.borderRadius = savedProfileRadius + 'px';
                });
            }
            
            const savedLogoRadius = localStorage.getItem('logo-radius');
            if (savedLogoRadius) {
                const logoImages = container.querySelectorAll('.company-logo');
                logoImages.forEach(img => {
                    img.style.borderRadius = savedLogoRadius + 'px';
                });
            }
        }
    };

    // Register this template with the main application
    if (window.EmailSignatureApp && window.EmailSignatureApp.registerTemplate) {
        window.EmailSignatureApp.registerTemplate(modernTemplate);
    } else {
        // If the app isn't ready yet, wait for it
        document.addEventListener('EmailSignatureAppReady', function() {
            window.EmailSignatureApp.registerTemplate(modernTemplate);
        });
    }

    // Export the template info for direct access
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = modernTemplate;
    } else if (window) {
        window.ModernTemplate = modernTemplate;
    }
})();
