BacklogMatters
==============

Starting
  1. Double-click "Start BacklogMatters".
  2. Your browser opens to http://localhost:4780.

  A black window stays open while BacklogMatters runs. Close it to stop.
  If Windows shows "Windows protected your PC", choose "More info" and
  then "Run anyway".

Your data
  Everything is saved in the "data" folder next to this file.
  To back up, click "Download backup" on the Projects page (or, with
  sign-in on, on the Administration page). You can also stop
  BacklogMatters and copy the data folder.
  To restore a backup, stop BacklogMatters and put the file in the data
  folder, named backlogmatters.db.
  To move to another PC, copy this whole folder.

Sign-in and administration (off by default)
  BacklogMatters starts without a sign-in screen and is for one person on
  this PC. To add sign-in, user accounts and an administration page, open
  "Start BacklogMatters.cmd" in Notepad, remove the word "rem" in front of
  set "BM_ACCOUNTS=1", save, and start BacklogMatters again. You are then
  asked to create an administrator account.

  If you later forget the administrator password, double-click
  "Reset Admin Password" and follow the prompts.

Removing
  Delete this folder. Nothing else was installed on the PC.
