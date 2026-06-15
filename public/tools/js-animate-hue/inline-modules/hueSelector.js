// Inline HueSelector module for file:// protocol support
window.HueSelector = class HueSelector {
    constructor(svgElement, onChange) {
        this.svg = svgElement;
        this.onChange = onChange;
        this.radius = 140;
        this.innerRadius = 100;
        this.centerX = 150;
        this.centerY = 145;
        
        this.startAngle = -180;
        this.endAngle = 0;
        
        this.handles = {
            start: { angle: -180 },
            end: { angle: 0 }
        };
        
        this.activeHandle = null;
        this.init();
    }

    init() {
        this.createWheel();
        this.createHandles();
        this.attachEvents();
        this.updateDisplay();
    }

    createWheel() {
        const segments = 180;
        const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        
        for (let i = 0; i < segments; i++) {
            const startAngle = -180 + (i * 180 / segments);
            const endAngle = -180 + ((i + 1) * 180 / segments);
            
            const path = this.createArcPath(startAngle, endAngle);
            
            // Convert angle to the actual hue value that would be returned by getValues()
            // This ensures the wheel shows the same colors as the gradient
            let hue = (startAngle + 180) * 2 - 180;
            
            // Normalize to 0-360 for hslToRgb
            while (hue < 0) hue += 360;
            while (hue >= 360) hue -= 360;
            
            const [r, g, b] = window.ColorUtils.hslToRgb(hue, 1, 0.5);
            
            path.setAttribute('fill', `rgb(${r}, ${g}, ${b})`);
            path.setAttribute('stroke', 'none');
            group.appendChild(path);
        }
        
        this.svg.appendChild(group);
    }

    createArcPath(startAngle, endAngle) {
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        
        const startRad = (startAngle * Math.PI) / 180;
        const endRad = (endAngle * Math.PI) / 180;
        
        const x1 = this.centerX + this.radius * Math.cos(startRad);
        const y1 = this.centerY + this.radius * Math.sin(startRad);
        const x2 = this.centerX + this.radius * Math.cos(endRad);
        const y2 = this.centerY + this.radius * Math.sin(endRad);
        
        const x3 = this.centerX + this.innerRadius * Math.cos(endRad);
        const y3 = this.centerY + this.innerRadius * Math.sin(endRad);
        const x4 = this.centerX + this.innerRadius * Math.cos(startRad);
        const y4 = this.centerY + this.innerRadius * Math.sin(startRad);
        
        const d = `
            M ${x1} ${y1}
            A ${this.radius} ${this.radius} 0 0 1 ${x2} ${y2}
            L ${x3} ${y3}
            A ${this.innerRadius} ${this.innerRadius} 0 0 0 ${x4} ${y4}
            Z
        `;
        
        path.setAttribute('d', d);
        return path;
    }

    createHandles() {
        const handleGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        
        this.handles.start.element = this.createHandle('start', '#3498db');
        this.handles.end.element = this.createHandle('end', '#e74c3c');
        
        handleGroup.appendChild(this.handles.start.element);
        handleGroup.appendChild(this.handles.end.element);
        this.svg.appendChild(handleGroup);
    }

    createHandle(type, color) {
        const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        group.setAttribute('class', `handle ${type}-handle`);
        group.style.cursor = 'pointer';
        
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('r', '12');
        circle.setAttribute('fill', color);
        circle.setAttribute('stroke', 'white');
        circle.setAttribute('stroke-width', '3');
        
        group.appendChild(circle);
        return group;
    }

    attachEvents() {
        this.svg.addEventListener('mousedown', this.handleMouseDown.bind(this));
        document.addEventListener('mousemove', this.handleMouseMove.bind(this));
        document.addEventListener('mouseup', this.handleMouseUp.bind(this));
    }

    handleMouseDown(e) {
        const rect = this.svg.getBoundingClientRect();
        const point = {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top
        };
        
        const startPos = this.getHandlePosition('start');
        const endPos = this.getHandlePosition('end');
        
        const startDist = Math.sqrt(Math.pow(point.x - startPos.x, 2) + Math.pow(point.y - startPos.y, 2));
        const endDist = Math.sqrt(Math.pow(point.x - endPos.x, 2) + Math.pow(point.y - endPos.y, 2));
        
        if (startDist < 20) {
            this.activeHandle = 'start';
        } else if (endDist < 20) {
            this.activeHandle = 'end';
        }
    }

    handleMouseMove(e) {
        if (!this.activeHandle) return;
        
        const rect = this.svg.getBoundingClientRect();
        const point = {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top
        };
        
        const angle = Math.atan2(point.y - this.centerY, point.x - this.centerX);
        let degrees = (angle * 180) / Math.PI;
        degrees = Math.max(-180, Math.min(0, degrees));
        
        this.handles[this.activeHandle].angle = degrees;
        this.updateDisplay();
        
        if (this.onChange) {
            this.onChange(this.getValues());
        }
    }

    handleMouseUp() {
        this.activeHandle = null;
    }

    getHandlePosition(type) {
        const angle = (this.handles[type].angle * Math.PI) / 180;
        const avgRadius = (this.radius + this.innerRadius) / 2;
        return {
            x: this.centerX + avgRadius * Math.cos(angle),
            y: this.centerY + avgRadius * Math.sin(angle)
        };
    }

    updateDisplay() {
        ['start', 'end'].forEach(type => {
            const pos = this.getHandlePosition(type);
            this.handles[type].element.setAttribute('transform', `translate(${pos.x}, ${pos.y})`);
        });
    }

    getValues() {
        const startHue = (this.handles.start.angle + 180) * 2 - 180;
        const endHue = (this.handles.end.angle + 180) * 2 - 180;
        
        return { startHue, endHue };
    }

    setValues(startHue, endHue) {
        this.handles.start.angle = ((startHue + 180) / 2) - 180;
        this.handles.end.angle = ((endHue + 180) / 2) - 180;
        this.updateDisplay();
    }
};