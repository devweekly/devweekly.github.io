import fs from 'fs';
import { extract } from '@extractus/feed-extractor'

const result = await extract('https://news.google.com/rss')
console.log(result);

fs.writeFile('./src/content/blog/data.txt', JSON.stringify(result), (err) => {

    if (err) {
      console.error(err);
      return;
    }

    console.log('File has been updated');
});
