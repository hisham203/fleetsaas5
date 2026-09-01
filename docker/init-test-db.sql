-- Runs once when the postgres container's data volume is first created.
-- Creates the separate test database the automated test suite uses.
CREATE DATABASE fleet_ops_test;
