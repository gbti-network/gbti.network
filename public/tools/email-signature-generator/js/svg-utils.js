/**
 * SVG Utilities for Email Signature Generator
 * Provides functions for dynamically coloring SVG icons
 */

const svgUtils = {
    /**
     * Applies color to SVG elements using CSS mask technique
     * @param {string} selector - CSS selector for the SVG container
     * @param {string} color - CSS color value to apply
     */
    colorSvgIcon: function(selector, color) {
        const elements = document.querySelectorAll(selector);
        elements.forEach(element => {
            element.style.backgroundColor = color;
        });
    },

    /**
     * Updates gradient colors for elements that use gradients
     * @param {string} startColor - Start color for gradient
     * @param {string} endColor - End color for gradient
     */
    updateGradientColors: function(startColor, endColor) {
        document.documentElement.style.setProperty('--gradient-start', startColor);
        document.documentElement.style.setProperty('--gradient-end', endColor);
    },

    /**
     * Updates custom theme colors
     * @param {string} primary - Primary color
     * @param {string} secondary - Secondary color
     * @param {string} accent - Accent color
     */
    updateThemeColors: function(primary, secondary, accent) {
        document.documentElement.style.setProperty('--primary-color', primary);
        document.documentElement.style.setProperty('--secondary-color', secondary);
        document.documentElement.style.setProperty('--accent-color', accent);
    }
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = svgUtils;
}
