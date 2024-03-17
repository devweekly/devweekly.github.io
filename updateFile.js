const fs = require('fs');

fs.writeFile('/src/content/blog/data.json', updatedData, (err) => {
    if (err) {
      console.error(err);
      return;
    }
    console.log('File has been updated');
});
