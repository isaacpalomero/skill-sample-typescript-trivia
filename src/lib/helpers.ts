// getRandomItem
export function getRandomItem(arrayOfItems: any[]) {
    // the argument is an array [] of words or phrases
    let i = 0;
    i = Math.floor(Math.random() * arrayOfItems.length);
    return (arrayOfItems[i]);
}
