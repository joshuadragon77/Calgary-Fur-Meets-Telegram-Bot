/**
 * JadesTS-JS MODULES >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
 * -----------------------------------------------------
 * ART.TS
 * -----------------------------------------------------
 * 
 * Author: Joshua Null (TheJades)
 * 
 * what is it about
 * 
 *  ⚬ delivering basic functionality for canvas context 2d drawing
 *  ⚬ adds the class obtainable image for easy image caching and handling for canvas context 2d drawing
 *  ⚬ provides a wrap engine for basic text wrapping
 *  ⚬ provides color mixing and basic color objects
 *  ⚬ adds basic image manipulation
 * 
 * 
 * 
 * heve fun
 */

/**
 */

export class Formatter{
    static toTimeString(seconds: number){
        return `${seconds / 60 < 10 ? "0" : ""}${Math.floor(seconds / 60)}:${seconds % 60 < 10 ? "0" : ""}${Math.floor(seconds % 60)}`;
    }
}

export class Color{
    r: number = 0;
    g: number = 0;
    b: number = 0;
    a: number = 1;

    static fromArray(array: [number, number, number, number] | [number, number, number]){
        return new Color(array[0], array[1], array[2], array[3] || 0);
    }

    static measureBrightness(c: Color){
        return (c.r + c.g + c.b)/3.0/255;
    }

    static immediate(r: number, g: number, b: number, a: number = 1){
        return new Color(r, g, b, a).toStyle();
    }

    constructor(r: number, g: number, b: number, a: number = 1){
        this.r = Math.min(255, Math.max(0, r));
        this.g = Math.min(255, Math.max(0, g));
        this.b = Math.min(255, Math.max(0, b));
        this.a = a;
    }

    toHex(){
        let characters = "0123456789abcdef";

        function getHexdecimalValue(number: number){
            return `${characters[Math.floor(number / 16)]}${characters[Math.floor(number % 16)]}`;
        }

        return `${getHexdecimalValue(this.r)}${getHexdecimalValue(this.g)}${getHexdecimalValue(this.b)}`;
    }

    toStyle(){
        return `rgba(${this.r}, ${this.g}, ${this.b}, ${this.a})`;
    }

    toANSIBackground(){
        return `\x1B[48;2;${Math.round(this.r)};${Math.round(this.g)};${Math.round(this.b)}m`;
    }
    toANSIForeground(){
        return `\x1B[38;2;${Math.round(this.r)};${Math.round(this.g)};${Math.round(this.b)}m`;
    }
}

export class ColorMixer{

    static screen(a: Color, b: Color){
        return new Color(
            255 - (255 - a.r) * (255 - b.r) / 255,
            255 - (255 - a.g) * (255 - b.g) / 255,
            255 - (255 - a.b) * (255 - b.b) / 255,
        )
    }

    static multiply(a: Color, b: Color){
        return new Color(
            a.r * b.r / 255,
            a.g * b.g / 255,
            a.b * b.b / 255,
        )
    }

    static lerp(a: Color, b: Color, lerpFactor: number){
        return new Color(
            a.r + (b.r - a.r) * lerpFactor,
            a.g + (b.g - a.g) * lerpFactor,
            a.b + (b.b - a.b) * lerpFactor,
            a.a + (b.a - a.a) * lerpFactor,
        );
    }

    static darken(a: Color){
        return new Color(Math.max(a.r*0.7, 0),
                Math.max(a.g*0.7, 0),
                Math.max(a.b*0.7, 0),
                a.a
        );
    }

    static brighten(color: Color){
        let r = color.r;
        let g = color.g;
        let b = color.b;
        let alpha = color.a;

        /* From 2D group:
        * 1. black.brighter() should return grey
        * 2. applying brighter to blue will always return blue, brighter
        * 3. non pure color (non zero rgb) will eventually return white
        */
        let i = Math.floor(1.0/(1.0-0.7));
        if ( r == 0 && g == 0 && b == 0) {
            return new Color(i, i, i, alpha);
        }
        if ( r > 0 && r < i ) r = i;
        if ( g > 0 && g < i ) g = i;
        if ( b > 0 && b < i ) b = i;

        return new Color(Math.min(r/0.7, 255),
                Math.min(g/0.7, 255),
                Math.min(b/0.7, 255),
                alpha
        );
    }

    static newOpacity(a: Color, alpha: number){
        return new Color(a.r, a.g, a.b, alpha);
    }
}
