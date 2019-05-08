module.exports = function (labels) {
  const kreditsLabel = labels.filter(n => n.match(/^kredits/))[0];
  // No label, no kredits
  if (typeof kreditsLabel === 'undefined') { return 0; }

  // TODO move amounts to config?
  let amount;
  switch(kreditsLabel) {
    case 'kredits-1':
      amount = 500;
      break;
    case 'kredits-2':
      amount = 1500;
      break;
    case 'kredits-3':
      amount = 5000;
      break;
  }

  return amount;
};
