// Inline ColorUtils module for file:// protocol support
window.ColorUtils = {
    rgbToHsl: function(r, g, b) {
        r /= 255;
        g /= 255;
        b /= 255;

        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        let h, s, l = (max + min) / 2;

        if (max === min) {
            h = s = 0; // achromatic
        } else {
            const d = max - min;
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            
            switch (max) {
                case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
                case g: h = ((b - r) / d + 2) / 6; break;
                case b: h = ((r - g) / d + 4) / 6; break;
            }
        }

        return [h * 360, s, l];
    },

    hslToRgb: function(h, s, l) {
        h /= 360;
        
        let r, g, b;

        if (s === 0) {
            r = g = b = l; // achromatic
        } else {
            const hue2rgb = (p, q, t) => {
                if (t < 0) t += 1;
                if (t > 1) t -= 1;
                if (t < 1/6) return p + (q - p) * 6 * t;
                if (t < 1/2) return q;
                if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
                return p;
            };

            const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
            const p = 2 * l - q;
            
            r = hue2rgb(p, q, h + 1/3);
            g = hue2rgb(p, q, h);
            b = hue2rgb(p, q, h - 1/3);
        }

        return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
    },

    shiftHue: function(r, g, b, hueShift) {
        const [h, s, l] = this.rgbToHsl(r, g, b);
        const newHue = (h + hueShift) % 360;
        return this.hslToRgb(newHue < 0 ? newHue + 360 : newHue, s, l);
    },

    createGradientStops: function(startHue, endHue, steps = 10) {
        const stops = [];
        const hueRange = endHue - startHue;
        
        for (let i = 0; i <= steps; i++) {
            const progress = i / steps;
            let hue = startHue + (hueRange * progress);
            
            // Normalize hue to 0-360 range
            while (hue < 0) hue += 360;
            while (hue >= 360) hue -= 360;
            
            const [r, g, b] = this.hslToRgb(hue, 1, 0.5);
            stops.push(`rgb(${r}, ${g}, ${b})`);
        }
        
        return stops;
    },

    adjustBrightness: function(imageData, brightness) {
        const data = imageData.data;
        const factor = this.mapBrightness(brightness);
        
        for (let i = 0; i < data.length; i += 4) {
            data[i] = Math.min(255, Math.max(0, data[i] * factor));
            data[i + 1] = Math.min(255, Math.max(0, data[i + 1] * factor));
            data[i + 2] = Math.min(255, Math.max(0, data[i + 2] * factor));
        }
        
        return imageData;
    },

    adjustContrast: function(imageData, contrast) {
        const data = imageData.data;
        const factor2 = this.mapContrast(contrast);
        
        for (let i = 0; i < data.length; i += 4) {
            data[i] = Math.min(255, Math.max(0, factor2 * (data[i] - 128) + 128));
            data[i + 1] = Math.min(255, Math.max(0, factor2 * (data[i + 1] - 128) + 128));
            data[i + 2] = Math.min(255, Math.max(0, factor2 * (data[i + 2] - 128) + 128));
        }
        
        return imageData;
    },

    mapBrightness: function(value) {
        if (value < 0) {
            return 0.1 + (value + 100) * 0.9 / 100;
        } else if (value === 0) {
            return 1;
        } else {
            return 1.0 + value * 1.0 / 100;
        }
    },

    mapContrast: function(value) {
        if (value < 0) {
            return Math.max(0.0, 1 + (value / 100.0) * 0.5);
        } else {
            return 1 + (value / 100.0) * 3.0;
        }
    }
};