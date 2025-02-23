use nightscout;
insert into auth_user (id, name, email, login_allowed, role) values ('test_id', 'Test User', 'test@test.com', 1, 'admin');
insert into ns_domain (active, title, domain, port, api_secret, enable, show_plugins, auth_user_id) values (1, 'Test', 'test', 0, '000000000000', 'some pluging', 'some more plugins', 'test_id');
