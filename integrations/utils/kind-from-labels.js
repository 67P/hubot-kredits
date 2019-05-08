module.exports = function (labels) {
  let kind = 'dev';

  if (labels.find(l => l.match(/ops|operations/)))  {
    kind = 'ops';
  }
  else if (labels.find(l => l.match(/docs|documentation/)))  {
    kind = 'docs';
  }
  else if (labels.find(l => l.match(/design/)))  {
    kind = 'design';
  }
  else if (labels.find(l => l.match(/community/)))  {
    kind = 'community';
  }

  return kind;
};
