const board = require('./menu-board.cjs');
module.exports = async (_root,output) => {
  const {createTrayIcon}=require('../../dist-electron/trayIcon.js');
  return board(output,'menu-bar.png','Repoes Sweep · menu-bar icons',[
    {label:'Dark menu bar · all clones clean and current',png:createTrayIcon(true,true).toPNG()},
    {label:'Dark menu bar · pending repository work',png:createTrayIcon(false,true).toPNG()},
    {label:'Light menu bar · all clones clean and current',background:'#e8eff8',png:createTrayIcon(true,false).toPNG()},
    {label:'Light menu bar · pending repository work',background:'#e8eff8',png:createTrayIcon(false,false).toPNG()},
  ],'Actual Repoes Sweep menu-bar marks: green diamond when clean, gray diamond when repository work remains.');
};
