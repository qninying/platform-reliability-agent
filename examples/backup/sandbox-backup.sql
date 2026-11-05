-- A sandbox backup for the restore rehearsal: tables modelled on the platform's AiAgent and DeadLetterJob models, with
-- rows invented for this demonstration. Not a production backup and no production data.
CREATE TABLE ai_agents (agent_name VARCHAR(100) NOT NULL UNIQUE, agent_type VARCHAR(50) NOT NULL, status VARCHAR(20) NOT NULL DEFAULT 'idle', enabled BOOLEAN NOT NULL DEFAULT TRUE, run_count INTEGER NOT NULL DEFAULT 0, error_count INTEGER NOT NULL DEFAULT 0);
CREATE TABLE dead_letter_jobs (id INTEGER PRIMARY KEY, job_name VARCHAR(100) NOT NULL, consecutive_failures INTEGER NOT NULL DEFAULT 0, error_class VARCHAR(100) NOT NULL, resolved BOOLEAN NOT NULL DEFAULT FALSE);
INSERT INTO ai_agents (agent_name, agent_type, status, enabled, run_count, error_count) VALUES ('SampleHealthAgent', 'monitor', 'idle', 1, 120, 2);
INSERT INTO ai_agents (agent_name, agent_type, status, enabled, run_count, error_count) VALUES ('SampleRepairAgent', 'executor', 'idle', 1, 40, 0);
INSERT INTO ai_agents (agent_name, agent_type, status, enabled, run_count, error_count) VALUES ('SampleDigestAgent', 'reporter', 'paused', 1, 15, 1);
INSERT INTO ai_agents (agent_name, agent_type, status, enabled, run_count, error_count) VALUES ('SampleRetiredAgent', 'reporter', 'idle', 0, 300, 9);
INSERT INTO ai_agents (agent_name, agent_type, status, enabled, run_count, error_count) VALUES ('SampleQuietAgent', 'monitor', 'idle', 0, 0, 0);
INSERT INTO ai_agents (agent_name, agent_type, status, enabled, run_count, error_count) VALUES ('SampleSweepAgent', 'executor', 'error', 1, 75, 30);
INSERT INTO dead_letter_jobs (id, job_name, consecutive_failures, error_class, resolved) VALUES (1, 'SampleSweepAgent', 3, 'TimeoutError', 0);
INSERT INTO dead_letter_jobs (id, job_name, consecutive_failures, error_class, resolved) VALUES (2, 'SampleSweepAgent', 4, 'TimeoutError', 1);
INSERT INTO dead_letter_jobs (id, job_name, consecutive_failures, error_class, resolved) VALUES (3, 'SampleDigestAgent', 3, 'RateLimitError', 0);
