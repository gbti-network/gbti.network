/**
 * Template Selector
 * Provides a UI for selecting email signature templates
 */

document.addEventListener('DOMContentLoaded', function() {
    // Helper function to resolve asset paths
    function resolveTemplatePath(path) {
        // Check if we're running in WordPress environment
        if (typeof EmailSignatureGeneratorConfig !== 'undefined' && EmailSignatureGeneratorConfig.isWordPress) {
            // Prepend the tool base URL to the path
            return EmailSignatureGeneratorConfig.toolBaseUrl + path;
        }
        
        // Return original path in non-WordPress environment
        return path;
    }
    
    // Initialize the template selector
    function initializeTemplateSelector() {
        DEBUG.info('Initializing template selector...');
        
        // Get the templates from EmailSignatureApp
        const templates = window.EmailSignatureApp?.getTemplates() || [];
        if (templates.length === 0) {
            console.warn('No templates found for selector');
            return;
        }
        
        // Get DOM elements
        const currentTemplateThumb = document.getElementById('current-template-thumb');
        const currentTemplateName = document.getElementById('current-template-name');
        const changeTemplateBtn = document.getElementById('change-template-btn');
        const templateOptions = document.getElementById('template-options');
        
        // Populate template options
        templates.forEach(template => {
            const option = document.createElement('div');
            option.className = 'template-option';
            option.setAttribute('data-template', template.name);
            
            // Create the thumbnail image
            const img = document.createElement('img');
            img.src = resolveTemplatePath('templates/' + template.name + '/thumbnail.webp');

            img.alt = `${template.displayName} Template`;
            img.onerror = function() {
                // Fallback if thumbnail doesn't exist
                this.src = resolveTemplatePath('assets/placeholder.png');
                this.onerror = null;
            };
            
            // Create the template name
            const name = document.createElement('div');
            name.className = 'template-option-name';
            name.textContent = template.displayName || template.name;
            
            // Add elements to option
            option.appendChild(img);
            option.appendChild(name);
            templateOptions.appendChild(option);
            
            // Add click event to select this template
            option.addEventListener('click', function() {
                const templateName = this.getAttribute('data-template');
                if (templateName && typeof window.loadTemplate === 'function') {
                    window.loadTemplate(templateName);
                    updateSelectedTemplate(templateName);
                    templateOptions.classList.remove('active');
                    
                    // Toggle sidebar-specific fields based on the selected template
                    toggleSidebarFields(templateName);
                }
            });
        });
        
        // Toggle template options when button is clicked
        if (changeTemplateBtn) {
            changeTemplateBtn.addEventListener('click', function() {
                templateOptions.classList.toggle('active');
            });
        }
        
        // Set the initial template based on what's currently loaded
        const currentTemplate = getCurrentTemplate() || 'classic';
        updateSelectedTemplate(currentTemplate);
        
        // Toggle sidebar fields for initial template
        toggleSidebarFields(currentTemplate);
    }
    
    // Get the currently active template
    function getCurrentTemplate() {
        // Check visible signature container
        const visibleContainer = document.querySelector('[id$="-signature-container"][style*="block"]');
        if (visibleContainer) {
            const id = visibleContainer.id;
            return id.replace('-signature-container', '');
        }
        return null;
    }
    
    // Update the selected template UI
    function updateSelectedTemplate(templateName) {
        DEBUG.info(`Updating selected template: ${templateName}`);
        
        const currentTemplateThumb = document.getElementById('current-template-thumb');
        const currentTemplateName = document.getElementById('current-template-name');
        
        // Get template info
        const templates = window.EmailSignatureApp?.getTemplates() || [];
        const templateInfo = templates.find(t => t.name === templateName) || { 
            name: templateName, 
            displayName: templateName.charAt(0).toUpperCase() + templateName.slice(1) 
        };
        
        // Update current template display
        if (currentTemplateThumb) {
            currentTemplateThumb.src = resolveTemplatePath('templates/' + templateName + '/thumbnail.webp');
            currentTemplateThumb.alt = `${templateInfo.displayName} Template`;
            currentTemplateThumb.style.width = 'auto';
            currentTemplateThumb.style.height = '60px';
            currentTemplateThumb.style.objectFit = 'cover';
            currentTemplateThumb.style.border = '1px solid #ddd';
            currentTemplateThumb.style.borderRadius = '4px';
            currentTemplateThumb.onerror = function() {
                this.src = resolveTemplatePath('assets/placeholder.png');
                this.onerror = null;
            };
        }
        
        if (currentTemplateName) {
            currentTemplateName.textContent = templateInfo.displayName || templateName;
        }
        
        // Update active class in options
        document.querySelectorAll('.template-option').forEach(option => {
            if (option.getAttribute('data-template') === templateName) {
                option.classList.add('active');
            } else {
                option.classList.remove('active');
            }
        });
        
        // Hide the template options after selection
        const templateOptions = document.getElementById('template-options');
        if (templateOptions) {
            templateOptions.classList.remove('active');
        }
    }
    
    // Function to toggle sidebar-specific fields based on the selected template
    function toggleSidebarFields(templateName) {
        const sidebarFields = document.querySelectorAll('.sidebar-template-fields');
        const isSidebarTemplate = templateName === 'sidebar';
        
        DEBUG.info(`Toggling sidebar fields: ${isSidebarTemplate ? 'show' : 'hide'}`);
        
        sidebarFields.forEach(element => {
            element.style.display = isSidebarTemplate ? 'flex' : 'none';
        });
    }
    
    // Initialize when EmailSignatureApp is ready
    if (window.EmailSignatureApp) {
        initializeTemplateSelector();
    } else {
        // Wait for EmailSignatureApp to be ready
        document.addEventListener('emailSignatureAppReady', initializeTemplateSelector);
        
        // Or try again after a delay as fallback
        setTimeout(() => {
            if (window.EmailSignatureApp) {
                initializeTemplateSelector();
            }
        }, 1000);
    }
    
    // Export updateSelectedTemplate function globally
    window.updateSelectedTemplate = updateSelectedTemplate;
});
