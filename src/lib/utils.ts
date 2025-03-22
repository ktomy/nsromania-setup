/**
 * Formats a given Date object into a string with the format yyyy-MM-dd HH:mm:ss.
 *
 * @param date - The Date object to format.
 * @returns A string representing the formatted date and time.
 */
export const formatDate = (date: Date | null | undefined): string => {
    if (date === null || date === undefined) {
        return '<no date>';
    }
    if (!(date instanceof Date)) {
        date = new Date(date);
    }

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');

    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
};

/**
 * This function formats a number of bytes into a human-readable string.
 * Examples:
 * ```ts
 * 1024 -> "1 KB"
 * 1024 * 1024 -> "1 MB"
 * ```
 * @param bytes number of bytes to format
 * @returns
 */
export function formatBytes(bytes: number | null): string {
    if (bytes === null) return 'Unknown';
    if (bytes === 0) return '0 Bytes';

    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
    const k = 1024; // Factor for conversion
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    const value = bytes / Math.pow(k, i);
    const roundedValue = i === 0 ? value : Math.min(parseFloat(value.toFixed(2)), parseFloat(value.toFixed(0))); // Avoid decimals for "Bytes"

    return `${roundedValue} ${sizes[i]}`;
}
