<?php
/* Entry point.
     ?t=<token>       student view: only the lesson's cards, no account needed
     ?api=share       (POST, logged in) signs a student link for a card set
     ?api=feedback    (POST, logged in) saves a report and mails it (feedback_to)
     ?logout=<csrf>   logs out
   otherwise: the teacher app if logged in, else the login page (or the
   first-run setup page while there are no accounts yet). */
define('BBF', 1);
require __DIR__ . '/inc/core.php';

/* ---------- student link ---------- */
if (isset($_GET['t'])) {
    $r = check_student_token($_GET['t']);
    if (!is_array($r)) {
        $why = array(
            'expired' => 'Questo link è scaduto. Chiedi all\'insegnante quello di oggi.',
            'revoked' => 'Questo link non è più valido. Chiedi all\'insegnante un nuovo link.',
            'invalid' => 'Questo link non è valido. Controlla di averlo copiato tutto.',
        );
        http_response_code(403);
        page('Link non valido', '<div class="card"><h1>' . h(cfg('app_name')) . '</h1><div class="msg err">'
            . h($why[$r]) . '</div></div>');
    }
    list($uid, $exp, $s, $o) = $r;
    $cards = load_cards();
    $ids = array_map(function ($c) { return $c['id']; }, $cards['catalog']);
    $sel = decode_selection($s, $ids);
    $keep = array_flip($sel);
    $catalog = array_values(array_filter($cards['catalog'], function ($c) use ($keep) { return isset($keep[$c['id']]); }));
    users_tx(function (&$users) use ($uid) {
        if (!isset($users[$uid])) return;
        $users[$uid]['student_opens'] = (isset($users[$uid]['student_opens']) ? $users[$uid]['student_opens'] : 0) + 1;
        $users[$uid]['last_student_open'] = date('c');
    });
    render_app($catalog, $cards['cats'], array('mode' => 'board', 'sel' => $sel, 'opts' => $o, 'exp' => $exp));
}

/* ---------- first run: create the first administrator ---------- */
if (!users_all()) {
    ensure_data_dir();
    $err = '';
    if ((string)cfg('setup_code') === '') fail_page('Configurazione incompleta: manca setup_code in config.php.');
    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $email = norm_email(post('email'));
        $name = post('name');
        $pw = isset($_POST['password']) ? (string)$_POST['password'] : '';
        if (!hash_equals((string)cfg('setup_code'), post('code'))) $err = 'Codice di installazione errato.';
        elseif (!valid_email($email)) $err = 'Email non valida.';
        elseif ($name === '') $err = 'Scrivi il nome.';
        elseif (strlen($pw) < (int)cfg('min_password')) $err = 'La password deve avere almeno ' . (int)cfg('min_password') . ' caratteri.';
        elseif ($pw !== (isset($_POST['password2']) ? $_POST['password2'] : '')) $err = 'Le due password non coincidono.';
        else {
            $u = users_tx(function (&$users) use ($email, $name, $pw) {
                if ($users) return null;                  // someone was faster
                $u = new_user($email, $name, 'admin', '', $pw);
                $users[$u['uid']] = $u;
                return $u;
            });
            if ($u) { log_event('setup', $email); login_cookie($u); header('Location: admin.php'); exit; }
            header('Location: index.php'); exit;
        }
    }
    page('Prima configurazione', '<div class="card"><h1>' . h(cfg('app_name')) . '</h1>'
        . '<p class="sub">Prima configurazione: crea l\'account amministratore.</p>'
        . ($err ? '<div class="msg err">' . h($err) . '</div>' : '')
        . '<form method="post">'
        . '<label>Codice di installazione</label><input type="text" name="code" required autocomplete="off">'
        . '<label>Nome</label><input type="text" name="name" required value="' . h(post('name')) . '">'
        . '<label>Email</label><input type="email" name="email" required value="' . h(post('email')) . '">'
        . '<label>Password</label><input type="password" name="password" required autocomplete="new-password">'
        . '<label>Ripeti la password</label><input type="password" name="password2" required autocomplete="new-password">'
        . '<button>Crea l\'amministratore</button></form></div>');
}

/* ---------- logout ---------- */
if (isset($_GET['logout'])) {
    $u = current_user();
    if ($u && hash_equals(csrf_token(), (string)$_GET['logout'])) { log_event('logout', $u['email']); logout_cookie(); }
    header('Location: index.php');
    exit;
}

/* ---------- sign a student link ---------- */
if (isset($_GET['api']) && $_GET['api'] === 'share') {
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    $u = current_user();
    if (!$u) { http_response_code(401); echo '{"error":"login"}'; exit; }
    $in = json_decode((string)file_get_contents('php://input'), true);
    $tok = null;
    if (is_array($in) && isset($_SERVER['HTTP_X_CSRF']) && hash_equals(csrf_token(), (string)$_SERVER['HTTP_X_CSRF'])) {
        $tok = make_student_token($u, isset($in['s']) ? (string)$in['s'] : '', isset($in['o']) ? (string)$in['o'] : '');
    }
    if (!$tok) { http_response_code(400); echo '{"error":"bad request"}'; exit; }
    echo json_encode($tok);
    exit;
}

/* ---------- a teacher's report (bug or change request) ---------- */
if (isset($_GET['api']) && $_GET['api'] === 'feedback') {
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    $u = current_user();
    if (!$u) { http_response_code(401); echo '{"error":"login"}'; exit; }
    $in = json_decode((string)file_get_contents('php://input'), true);
    if (!is_array($in) || !isset($_SERVER['HTTP_X_CSRF']) || !hash_equals(csrf_token(), (string)$_SERVER['HTTP_X_CSRF'])) {
        http_response_code(400); echo '{"error":"bad request"}'; exit;
    }
    $r = feedback_add($u, isset($in['type']) ? (string)$in['type'] : '', isset($in['text']) ? $in['text'] : '',
                      isset($in['ctx']) ? $in['ctx'] : array());
    if (!is_array($r)) { http_response_code(422); echo json_encode(array('error' => $r)); exit; }
    echo json_encode(array('ok' => true, 'mailed' => $r['mailed']));
    exit;
}

/* ---------- login ---------- */
$u = current_user();
if (!$u) {
    $err = '';
    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $r = try_login(post('email'), isset($_POST['password']) ? (string)$_POST['password'] : '');
        if (is_array($r)) { login_cookie($r); header('Location: index.php'); exit; }
        $err = $r;
    }
    page('Accesso', '<div class="card"><h1>' . h(cfg('app_name')) . '</h1>'
        . '<p class="sub">Accedi con l\'email e la password che hai ricevuto.</p>'
        . ($err ? '<div class="msg err">' . h($err) . '</div>' : '')
        . '<form method="post">'
        . '<label>Email</label><input type="email" name="email" required autocomplete="username" value="' . h(post('email')) . '">'
        . '<label>Password</label><input type="password" name="password" required autocomplete="current-password">'
        . '<button>Accedi</button></form></div>');
}

/* ---------- the teacher app ---------- */
$cards = load_cards();
render_app($cards['catalog'], $cards['cats'], array(
    'mode' => 'builder',
    'api' => 'index.php?api=share',
    'feedback' => 'index.php?api=feedback',
    'csrf' => csrf_token(),
    'user' => array('name' => $u['name'], 'admin' => $u['role'] === 'admin'),
    'links' => array('account' => 'account.php', 'admin' => 'admin.php', 'logout' => 'index.php?logout=' . csrf_token()),
));
