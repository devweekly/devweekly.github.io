const fs = require('fs');

const data = 'HELLO WORLD';

fs.writeFile('/src/content/blog/data.json', data, (err) => {
    if (err) {
      console.error(err);
      return;
    }
    console.log('File has been updated');
});
