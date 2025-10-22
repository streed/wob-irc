/**
 * Unicode to ASCII conversion utility
 * Handles removal or replacement of Unicode characters with ASCII equivalents
 */

/**
 * Map of common Unicode characters to their ASCII equivalents
 */
const unicodeToAsciiMap: Record<string, string> = {
  // Quotes
  '\u2018': "'", // Left single quotation mark
  '\u2019': "'", // Right single quotation mark
  '\u201A': "'", // Single low-9 quotation mark
  '\u201B': "'", // Single high-reversed-9 quotation mark
  '\u201C': '"', // Left double quotation mark
  '\u201D': '"', // Right double quotation mark
  '\u201E': '"', // Double low-9 quotation mark
  '\u201F': '"', // Double high-reversed-9 quotation mark
  '\u2032': "'", // Prime
  '\u2033': '"', // Double prime
  
  // Dashes and hyphens
  '\u2010': '-', // Hyphen
  '\u2011': '-', // Non-breaking hyphen
  '\u2012': '-', // Figure dash
  '\u2013': '-', // En dash
  '\u2014': '-', // Em dash
  '\u2015': '-', // Horizontal bar
  '\u2212': '-', // Minus sign
  
  // Spaces
  '\u00A0': ' ', // Non-breaking space
  '\u2000': ' ', // En quad
  '\u2001': ' ', // Em quad
  '\u2002': ' ', // En space
  '\u2003': ' ', // Em space
  '\u2004': ' ', // Three-per-em space
  '\u2005': ' ', // Four-per-em space
  '\u2006': ' ', // Six-per-em space
  '\u2007': ' ', // Figure space
  '\u2008': ' ', // Punctuation space
  '\u2009': ' ', // Thin space
  '\u200A': ' ', // Hair space
  '\u202F': ' ', // Narrow no-break space
  '\u205F': ' ', // Medium mathematical space
  
  // Ellipsis
  '\u2026': '...', // Horizontal ellipsis
  
  // Bullets and marks
  '\u2022': '*', // Bullet
  '\u2023': '*', // Triangular bullet
  '\u2024': '.', // One dot leader
  '\u2025': '..', // Two dot leader
  '\u2043': '-', // Hyphen bullet
  '\u25E6': 'o', // White bullet
  '\u25CF': '*', // Black circle
  '\u25CB': 'o', // White circle
  
  // Mathematical operators
  '\u00D7': 'x', // Multiplication sign
  '\u00F7': '/', // Division sign
  '\u2215': '/', // Division slash
  '\u2216': '\\', // Set minus
  '\u2217': '*', // Asterisk operator
  '\u2260': '!=', // Not equal to
  '\u2264': '<=', // Less-than or equal to
  '\u2265': '>=', // Greater-than or equal to
  '\u00B1': '+/-', // Plus-minus sign
  
  // Arrows
  '\u2190': '<-', // Leftwards arrow
  '\u2192': '->', // Rightwards arrow
  '\u2191': '^', // Upwards arrow
  '\u2193': 'v', // Downwards arrow
  '\u2194': '<->', // Left right arrow
  
  // Currency (basic)
  '\u00A3': 'GBP', // Pound sign
  '\u00A5': 'YEN', // Yen sign
  '\u20AC': 'EUR', // Euro sign
  
  // Degree and other symbols
  '\u00B0': 'deg', // Degree sign
  '\u00B5': 'u', // Micro sign
  '\u2103': 'C', // Degree Celsius
  '\u2109': 'F', // Degree Fahrenheit
  
  // Fractions
  '\u00BC': '1/4', // Vulgar fraction one quarter
  '\u00BD': '1/2', // Vulgar fraction one half
  '\u00BE': '3/4', // Vulgar fraction three quarters
  '\u2153': '1/3', // Vulgar fraction one third
  '\u2154': '2/3', // Vulgar fraction two thirds
  
  // Other common symbols
  '\u00A9': '(c)', // Copyright sign
  '\u00AE': '(R)', // Registered sign
  '\u2122': '(TM)', // Trade mark sign
  '\u00A7': 'S', // Section sign
  '\u00B6': 'P', // Pilcrow sign (paragraph)
  
  // Accented characters (common Latin extended)
  '\u00C0': 'A', '\u00C1': 'A', '\u00C2': 'A', '\u00C3': 'A', '\u00C4': 'A', '\u00C5': 'A',
  '\u00E0': 'a', '\u00E1': 'a', '\u00E2': 'a', '\u00E3': 'a', '\u00E4': 'a', '\u00E5': 'a',
  '\u00C8': 'E', '\u00C9': 'E', '\u00CA': 'E', '\u00CB': 'E',
  '\u00E8': 'e', '\u00E9': 'e', '\u00EA': 'e', '\u00EB': 'e',
  '\u00CC': 'I', '\u00CD': 'I', '\u00CE': 'I', '\u00CF': 'I',
  '\u00EC': 'i', '\u00ED': 'i', '\u00EE': 'i', '\u00EF': 'i',
  '\u00D2': 'O', '\u00D3': 'O', '\u00D4': 'O', '\u00D5': 'O', '\u00D6': 'O',
  '\u00F2': 'o', '\u00F3': 'o', '\u00F4': 'o', '\u00F5': 'o', '\u00F6': 'o',
  '\u00D9': 'U', '\u00DA': 'U', '\u00DB': 'U', '\u00DC': 'U',
  '\u00F9': 'u', '\u00FA': 'u', '\u00FB': 'u', '\u00FC': 'u',
  '\u00D1': 'N', '\u00F1': 'n',
  '\u00C7': 'C', '\u00E7': 'c',
  '\u00DD': 'Y', '\u00FD': 'y', '\u00FF': 'y',
};

/**
 * Sanitizes text by removing or replacing Unicode characters with ASCII equivalents
 * @param text - The text to sanitize
 * @returns The sanitized text with Unicode replaced by ASCII
 */
export function sanitizeUnicode(text: string): string {
  if (!text) {
    return text;
  }
  
  let sanitized = text;
  
  // Replace known Unicode characters with ASCII equivalents
  for (const [unicode, ascii] of Object.entries(unicodeToAsciiMap)) {
    sanitized = sanitized.split(unicode).join(ascii);
  }
  
  // Remove any remaining non-ASCII characters (outside the basic ASCII range 32-126)
  // Keep newlines (\n = 10), carriage returns (\r = 13), and tabs (\t = 9)
  sanitized = sanitized.replace(/[^\x09\x0A\x0D\x20-\x7E]/g, '');
  
  return sanitized;
}

/**
 * Sanitizes text more aggressively by removing control characters
 * and ensuring only printable ASCII remains
 * @param text - The text to sanitize
 * @returns The sanitized text
 */
export function sanitizeUnicodeStrict(text: string): string {
  if (!text) {
    return text;
  }
  
  // First apply standard sanitization
  let sanitized = sanitizeUnicode(text);
  
  // Remove control characters except newline and tab
  sanitized = sanitized.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, '');
  
  return sanitized;
}
