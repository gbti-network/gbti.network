/**
 * Minimalist Template Registration
 * This file handles the registration and initialization of the minimalist email signature template
 */

// Register the minimalist template
(function() {
    // Define the template information
    const minimalistTemplate = {
        name: 'minimalist',
        displayName: 'Minimalist',
        description: 'Simple, clean layout with minimal design elements',
        paths: {
            html: 'templates/minimalist/html/minimalist.html',
            css: 'templates/minimalist/css/minimalist.css'
        },
        
        /**
         * Initialize the template after it's loaded
         * @param {HTMLElement} container - The container element
         */
        initialize: function(container) {
            DEBUG.info('Initializing minimalist template');
            
            // Handle empty Calendly URL
            const calendlyUrl = document.getElementById('input-calendly').value;
            
            if (!calendlyUrl || calendlyUrl.trim() === '') {
                // Find and hide all elements with the calendly class
                const calendlyElements = container.querySelectorAll('.calendly');
                calendlyElements.forEach(element => {
                    element.style.display = 'none';
                });
                
                // Hide the Calendly icon in social icons section
                const calendlyIcon = container.querySelector('.sig-social-icons a[href*="calendly"]');
                if (calendlyIcon) {
                    calendlyIcon.style.display = 'none';
                }
                
                DEBUG.info('Minimalist template: Calendly elements hidden due to empty URL');
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
                DEBUG.info('Minimalist template: Applying profile radius:', radius);
                
                // Find all profile images and apply the border radius directly as inline style
                const profileImages = container.querySelectorAll('.profile-img, .profile-image');
                profileImages.forEach(img => {
                    img.style.borderRadius = radius;
                });
            });
            
            // Listen for logo radius change events
            document.addEventListener('logoRadiusChanged', function(e) {
                const radius = e.detail.radius;
                DEBUG.info('Minimalist template: Applying logo radius:', radius);
                
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
        window.EmailSignatureApp.registerTemplate(minimalistTemplate);
    } else {
        // If the app isn't ready yet, wait for it
        document.addEventListener('EmailSignatureAppReady', function() {
            window.EmailSignatureApp.registerTemplate(minimalistTemplate);
        });
    }

    // Export the template info for direct access
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = minimalistTemplate;
    } else if (window) {
        window.MinimalistTemplate = minimalistTemplate;
    }
})();
