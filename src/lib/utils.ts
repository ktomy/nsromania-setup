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