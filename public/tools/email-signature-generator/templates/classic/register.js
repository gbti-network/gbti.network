/**
 * Classic Template Registration
 * This file handles the registration and initialization of the classic email signature template
 */

// Register the classic template
(function() {
    // Define the template information
    const classicTemplate = {
        name: 'classic',
        displayName: 'Classic',
        description: 'Traditional layout with profile image and contact information',
        paths: {
            html: 'templates/classic/html/classic.html',
            css: 'templates/classic/css/classic.css'
        },
        
        /**
         * Initialize the template after it's loaded
         * @param {HTMLElement} container - The container element
         */
        initialize: function(container) {
            DEBUG.info('Initializing classic template');
            
            // Attach a listener to the Calendly input to handle changes
            const calendlyInput = document.getElementById('input-calendly');
            if (calendlyInput) {
                // Initial check on load
                updateCalendlyVisibility(container, calendlyInput.value);
                
                // Add event listener for future changes
                calendlyInput.addEventListener('input', function() {
                    updateCalendlyVisibility(container, this.value);
                });
                
                calendlyInput.addEventListener('change', function() {
                    updateCalendlyVisibility(container, this.value);
                });
            }
            
            // Listen for changes to the Calendly text
            const calendlyTextInput = document.getElementById('input-calendly-text');
            if (calendlyTextInput) {
                calendlyTextInput.addEventListener('input', function() {
                    updateCalendlyText(container, this.value);
                });
                
                calendlyTextInput.addEventListener('change', function() {
                    updateCalendlyText(container, this.value);
                });
                
                // Initial update
                updateCalendlyText(container, calendlyTextInput.value);
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
            
            // Function to update visibility based on Calendly URL
            function updateCalendlyVisibility(container, calendlyUrl) {
                DEBUG.info('Updating Calendly visibility. URL:', calendlyUrl);
                
                // Safety check - ensure container exists
                if (!container) {
                    console.error('Container not provided to updateCalendlyVisibility');
                    return;
                }
                
                if (!calendlyUrl || calendlyUrl.trim() === '') {
                    // Hide all elements with the calendly class EXCEPT those in social-icons section
                    const calendlyElements = container.querySelectorAll('.calendly:not(.social-icon):not(.sig-social-icons a)');
                    calendlyElements.forEach(element => {
                        // Don't hide if it's within a social-icons container or is a social icon
                        if (!element.closest('.sig-social-icons') && !element.classList.contains('social-icon')) {
                            element.style.display = 'none';
                        }
                    });
                    
                    // Hide the dedicated Calendly text/link section, but NOT social media icons
                    const dedicatedCalendlySection = container.querySelector('.contact.calendly');
                    if (dedicatedCalendlySection) {
                        dedicatedCalendlySection.style.display = 'none';
                    }
                    
                    DEBUG.info('Classic template: Dedicated Calendly elements hidden due to empty URL');
                } else {
                    // Show all elements with the calendly class
                    const calendlyElements = container.querySelectorAll('.calendly');
                    calendlyElements.forEach(element => {
                        element.style.display = '';
                    });
                    
                    DEBUG.info('Classic template: Calendly elements shown');
                }
            }
            
            // Listen for profile radius change events
            document.addEventListener('profileRadiusChanged', function(e) {
                const radius = e.detail.radius;
                DEBUG.info('Classic template: Applying profile radius:', radius);
                
                // Find all profile images and apply the border radius directly as inline style
                const profileImages = container.querySelectorAll('.profile-img, .profile-image');
                profileImages.forEach(img => {
                    img.style.borderRadius = radius;
                });
            });
            
            // Listen for logo radius change events
            document.addEventListener('logoRadiusChanged', function(e) {
                const radius = e.detail.radius;
                DEBUG.info('Classic template: Applying logo radius:', radius);
                
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
        window.EmailSignatureApp.registerTemplate(classicTemplate);
    } else {
        // If the app isn't ready yet, wait for it
        document.addEventListener('EmailSignatureAppReady', function() {
            window.EmailSignatureApp.registerTemplate(classicTemplate);
        });
    }

    // Export the template info for direct access
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = classicTemplate;
    } else if (window) {
        window.ClassicTemplate = classicTemplate;
    }
})();