<?php
/* Settings for this installation. tools/build.py copies this file to
   upload/flashcards/config.php the first time, with a random setup_code.
   Every key is optional except setup_code (defaults in inc/core.php). */
defined('BBF') or exit;
return array(
    'setup_code'         => '__SETUP_CODE__',  // asked once, to create the first administrator
    'login_days'         => 30,                // a login lasts this many days on a device
    'student_link_hours' => 0,                 // 0 = student links work until midnight
    'feedback_to'        => 'samuele.maccio@gmail.com',  // teachers' reports are mailed here (and always saved on admin.php)
    // 'data_dir'        => '/home/USER/bbf-data',   // better outside the public web folder, if FTP allows it
);
