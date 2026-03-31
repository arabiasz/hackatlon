/*
    Demo dataset for the dependency graph UI.

    What this script adds:
    - multiple schemas, tables, views, functions and procedures
    - a synonym node
    - a cross-database dependency shown as External
    - an unresolved dependency shown as Unknown

    Safe to rerun:
    - tables are created only when missing
    - programmable objects use CREATE OR ALTER
    - seed rows are inserted only when absent
*/

USE [master];
GO

IF DB_ID(N'RaportDb') IS NULL
BEGIN
    PRINT N'Creating [RaportDb]...';
    CREATE DATABASE [RaportDb];
END
GO

IF DB_ID(N'AnalyticsDb') IS NULL
BEGIN
    PRINT N'Creating [AnalyticsDb]...';
    CREATE DATABASE [AnalyticsDb];
END
GO

USE [AnalyticsDb];
GO

IF OBJECT_ID(N'dbo.PenaltyBenchmarks', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.PenaltyBenchmarks (
        BenchmarkId int IDENTITY(1,1) NOT NULL PRIMARY KEY,
        PenaltyCode nvarchar(20) NOT NULL UNIQUE,
        AvgSeverity decimal(5,2) NOT NULL,
        EscalationBand nvarchar(20) NOT NULL,
        SourceUpdatedAt datetime2 NOT NULL CONSTRAINT DF_PenaltyBenchmarks_SourceUpdatedAt DEFAULT sysdatetime()
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM dbo.PenaltyBenchmarks WHERE PenaltyCode = N'YELLOW')
BEGIN
    INSERT INTO dbo.PenaltyBenchmarks (PenaltyCode, AvgSeverity, EscalationBand)
    VALUES (N'YELLOW', 1.00, N'low');
END
GO

IF NOT EXISTS (SELECT 1 FROM dbo.PenaltyBenchmarks WHERE PenaltyCode = N'RED')
BEGIN
    INSERT INTO dbo.PenaltyBenchmarks (PenaltyCode, AvgSeverity, EscalationBand)
    VALUES (N'RED', 4.00, N'critical');
END
GO

IF NOT EXISTS (SELECT 1 FROM dbo.PenaltyBenchmarks WHERE PenaltyCode = N'FOUL')
BEGIN
    INSERT INTO dbo.PenaltyBenchmarks (PenaltyCode, AvgSeverity, EscalationBand)
    VALUES (N'FOUL', 2.00, N'medium');
END
GO

IF NOT EXISTS (SELECT 1 FROM dbo.PenaltyBenchmarks WHERE PenaltyCode = N'ABSENCE')
BEGIN
    INSERT INTO dbo.PenaltyBenchmarks (PenaltyCode, AvgSeverity, EscalationBand)
    VALUES (N'ABSENCE', 3.00, N'high');
END
GO

USE [RaportDb];
GO

IF SCHEMA_ID(N'audit') IS NULL
BEGIN
    EXEC(N'CREATE SCHEMA audit');
END
GO

IF SCHEMA_ID(N'security') IS NULL
BEGIN
    EXEC(N'CREATE SCHEMA security');
END
GO

IF SCHEMA_ID(N'reporting') IS NULL
BEGIN
    EXEC(N'CREATE SCHEMA reporting');
END
GO

IF SCHEMA_ID(N'integration') IS NULL
BEGIN
    EXEC(N'CREATE SCHEMA integration');
END
GO

IF SCHEMA_ID(N'staging') IS NULL
BEGIN
    EXEC(N'CREATE SCHEMA staging');
END
GO

IF SCHEMA_ID(N'archive') IS NULL
BEGIN
    EXEC(N'CREATE SCHEMA archive');
END
GO

IF OBJECT_ID(N'dbo.Teams', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Teams (
        TeamId int NOT NULL PRIMARY KEY,
        TeamCode nvarchar(10) NOT NULL UNIQUE,
        TeamName nvarchar(120) NOT NULL
    );
END
GO

IF OBJECT_ID(N'dbo.MatchFixtures', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.MatchFixtures (
        MatchId int NOT NULL PRIMARY KEY,
        HomeTeamId int NOT NULL,
        AwayTeamId int NOT NULL,
        KickoffUtc datetime2 NOT NULL,
        CONSTRAINT FK_MatchFixtures_HomeTeam FOREIGN KEY (HomeTeamId) REFERENCES dbo.Teams (TeamId),
        CONSTRAINT FK_MatchFixtures_AwayTeam FOREIGN KEY (AwayTeamId) REFERENCES dbo.Teams (TeamId)
    );
END
GO

IF OBJECT_ID(N'dbo.Players', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Players (
        PlayerId int NOT NULL PRIMARY KEY,
        TeamId int NOT NULL,
        PlayerName nvarchar(120) NOT NULL,
        PositionCode nvarchar(10) NOT NULL,
        IsActive bit NOT NULL CONSTRAINT DF_Players_IsActive DEFAULT (1),
        CONSTRAINT FK_Players_Teams FOREIGN KEY (TeamId) REFERENCES dbo.Teams (TeamId)
    );
END
GO

IF OBJECT_ID(N'dbo.PenaltyDefinitions', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.PenaltyDefinitions (
        PenaltyCode nvarchar(20) NOT NULL PRIMARY KEY,
        PenaltyName nvarchar(120) NOT NULL,
        SeverityPoints int NOT NULL,
        RequiresManualReview bit NOT NULL CONSTRAINT DF_PenaltyDefinitions_RequiresManualReview DEFAULT (0)
    );
END
GO

IF OBJECT_ID(N'dbo.PenaltyEvents', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.PenaltyEvents (
        EventId int IDENTITY(1,1) NOT NULL PRIMARY KEY,
        MatchId int NOT NULL,
        PlayerId int NOT NULL,
        PenaltyCode nvarchar(20) NOT NULL,
        SourceSystem nvarchar(40) NOT NULL,
        OccurredAt datetime2 NOT NULL CONSTRAINT DF_PenaltyEvents_OccurredAt DEFAULT sysdatetime(),
        IsResolved bit NOT NULL CONSTRAINT DF_PenaltyEvents_IsResolved DEFAULT (0),
        ReviewedBy sysname NULL,
        CONSTRAINT FK_PenaltyEvents_MatchFixtures FOREIGN KEY (MatchId) REFERENCES dbo.MatchFixtures (MatchId),
        CONSTRAINT FK_PenaltyEvents_Players FOREIGN KEY (PlayerId) REFERENCES dbo.Players (PlayerId),
        CONSTRAINT FK_PenaltyEvents_PenaltyDefinitions FOREIGN KEY (PenaltyCode) REFERENCES dbo.PenaltyDefinitions (PenaltyCode)
    );
END
GO

IF OBJECT_ID(N'audit.PenaltyAudit', N'U') IS NULL
BEGIN
    CREATE TABLE audit.PenaltyAudit (
        AuditId int IDENTITY(1,1) NOT NULL PRIMARY KEY,
        EventId int NOT NULL,
        AuditAction nvarchar(60) NOT NULL,
        CheckedAt datetime2 NOT NULL CONSTRAINT DF_PenaltyAudit_CheckedAt DEFAULT sysdatetime(),
        CheckedBy sysname NOT NULL,
        CONSTRAINT FK_PenaltyAudit_PenaltyEvents FOREIGN KEY (EventId) REFERENCES dbo.PenaltyEvents (EventId)
    );
END
GO

IF OBJECT_ID(N'security.PlayerPermissions', N'U') IS NULL
BEGIN
    CREATE TABLE security.PlayerPermissions (
        PermissionId int IDENTITY(1,1) NOT NULL PRIMARY KEY,
        PlayerId int NOT NULL,
        CanViewSensitiveData bit NOT NULL,
        CanCloseCase bit NOT NULL,
        LastReviewedAt datetime2 NOT NULL CONSTRAINT DF_PlayerPermissions_LastReviewedAt DEFAULT sysdatetime(),
        CONSTRAINT FK_PlayerPermissions_Players FOREIGN KEY (PlayerId) REFERENCES dbo.Players (PlayerId)
    );
END
GO

IF OBJECT_ID(N'staging.PenaltyIncoming', N'U') IS NULL
BEGIN
    CREATE TABLE staging.PenaltyIncoming (
        IncomingId int IDENTITY(1,1) NOT NULL PRIMARY KEY,
        ExternalEventRef nvarchar(50) NOT NULL UNIQUE,
        PlayerId int NOT NULL,
        PenaltyCode nvarchar(20) NOT NULL,
        MatchId int NOT NULL,
        ImportedAt datetime2 NOT NULL CONSTRAINT DF_PenaltyIncoming_ImportedAt DEFAULT sysdatetime(),
        Processed bit NOT NULL CONSTRAINT DF_PenaltyIncoming_Processed DEFAULT (0)
    );
END
GO

IF OBJECT_ID(N'integration.PenaltyImportBatch', N'U') IS NULL
BEGIN
    CREATE TABLE integration.PenaltyImportBatch (
        BatchId int IDENTITY(1,1) NOT NULL PRIMARY KEY,
        SourceSystem nvarchar(40) NOT NULL,
        ReceivedAt datetime2 NOT NULL CONSTRAINT DF_PenaltyImportBatch_ReceivedAt DEFAULT sysdatetime(),
        ImportedRows int NOT NULL
    );
END
GO

IF OBJECT_ID(N'reporting.PenaltyDashboardCache', N'U') IS NULL
BEGIN
    CREATE TABLE reporting.PenaltyDashboardCache (
        CacheId int IDENTITY(1,1) NOT NULL PRIMARY KEY,
        SnapshotLabel nvarchar(50) NOT NULL,
        PlayerId int NOT NULL,
        PenaltyTotal int NOT NULL,
        RiskBand nvarchar(20) NOT NULL,
        RefreshedAt datetime2 NOT NULL CONSTRAINT DF_PenaltyDashboardCache_RefreshedAt DEFAULT sysdatetime(),
        CONSTRAINT FK_PenaltyDashboardCache_Players FOREIGN KEY (PlayerId) REFERENCES dbo.Players (PlayerId)
    );
END
GO

IF OBJECT_ID(N'archive.PenaltyEventArchive', N'U') IS NULL
BEGIN
    CREATE TABLE archive.PenaltyEventArchive (
        ArchiveId int IDENTITY(1,1) NOT NULL PRIMARY KEY,
        EventId int NOT NULL,
        PlayerId int NOT NULL,
        PenaltyCode nvarchar(20) NOT NULL,
        ArchivedAt datetime2 NOT NULL CONSTRAINT DF_PenaltyEventArchive_ArchivedAt DEFAULT sysdatetime(),
        ArchiveReason nvarchar(80) NOT NULL
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM dbo.Teams WHERE TeamId = 1)
BEGIN
    INSERT INTO dbo.Teams (TeamId, TeamCode, TeamName)
    VALUES (1, N'WAW', N'Warsaw Wolves');
END
GO

IF NOT EXISTS (SELECT 1 FROM dbo.Teams WHERE TeamId = 2)
BEGIN
    INSERT INTO dbo.Teams (TeamId, TeamCode, TeamName)
    VALUES (2, N'KRK', N'Krakow Kings');
END
GO

IF NOT EXISTS (SELECT 1 FROM dbo.Teams WHERE TeamId = 3)
BEGIN
    INSERT INTO dbo.Teams (TeamId, TeamCode, TeamName)
    VALUES (3, N'GDN', N'Gdansk Giants');
END
GO

IF NOT EXISTS (SELECT 1 FROM dbo.MatchFixtures WHERE MatchId = 1001)
BEGIN
    INSERT INTO dbo.MatchFixtures (MatchId, HomeTeamId, AwayTeamId, KickoffUtc)
    VALUES (1001, 1, 2, '2026-03-15T17:00:00');
END
GO

IF NOT EXISTS (SELECT 1 FROM dbo.MatchFixtures WHERE MatchId = 1002)
BEGIN
    INSERT INTO dbo.MatchFixtures (MatchId, HomeTeamId, AwayTeamId, KickoffUtc)
    VALUES (1002, 2, 3, '2026-03-19T19:30:00');
END
GO

IF NOT EXISTS (SELECT 1 FROM dbo.MatchFixtures WHERE MatchId = 1003)
BEGIN
    INSERT INTO dbo.MatchFixtures (MatchId, HomeTeamId, AwayTeamId, KickoffUtc)
    VALUES (1003, 3, 1, '2026-03-24T20:15:00');
END
GO

IF NOT EXISTS (SELECT 1 FROM dbo.Players WHERE PlayerId = 10)
BEGIN
    INSERT INTO dbo.Players (PlayerId, TeamId, PlayerName, PositionCode, IsActive)
    VALUES (10, 1, N'Jan Lis', N'DEF', 1);
END
GO

IF NOT EXISTS (SELECT 1 FROM dbo.Players WHERE PlayerId = 11)
BEGIN
    INSERT INTO dbo.Players (PlayerId, TeamId, PlayerName, PositionCode, IsActive)
    VALUES (11, 1, N'Marek Zyla', N'MID', 1);
END
GO

IF NOT EXISTS (SELECT 1 FROM dbo.Players WHERE PlayerId = 20)
BEGIN
    INSERT INTO dbo.Players (PlayerId, TeamId, PlayerName, PositionCode, IsActive)
    VALUES (20, 2, N'Piotr Nowak', N'FWD', 1);
END
GO

IF NOT EXISTS (SELECT 1 FROM dbo.Players WHERE PlayerId = 21)
BEGIN
    INSERT INTO dbo.Players (PlayerId, TeamId, PlayerName, PositionCode, IsActive)
    VALUES (21, 2, N'Adam Wrona', N'DEF', 1);
END
GO

IF NOT EXISTS (SELECT 1 FROM dbo.Players WHERE PlayerId = 30)
BEGIN
    INSERT INTO dbo.Players (PlayerId, TeamId, PlayerName, PositionCode, IsActive)
    VALUES (30, 3, N'Lukasz Sikora', N'GK', 1);
END
GO

IF NOT EXISTS (SELECT 1 FROM dbo.PenaltyDefinitions WHERE PenaltyCode = N'YELLOW')
BEGIN
    INSERT INTO dbo.PenaltyDefinitions (PenaltyCode, PenaltyName, SeverityPoints, RequiresManualReview)
    VALUES (N'YELLOW', N'Yellow card', 1, 0);
END
GO

IF NOT EXISTS (SELECT 1 FROM dbo.PenaltyDefinitions WHERE PenaltyCode = N'RED')
BEGIN
    INSERT INTO dbo.PenaltyDefinitions (PenaltyCode, PenaltyName, SeverityPoints, RequiresManualReview)
    VALUES (N'RED', N'Red card', 4, 1);
END
GO

IF NOT EXISTS (SELECT 1 FROM dbo.PenaltyDefinitions WHERE PenaltyCode = N'FOUL')
BEGIN
    INSERT INTO dbo.PenaltyDefinitions (PenaltyCode, PenaltyName, SeverityPoints, RequiresManualReview)
    VALUES (N'FOUL', N'Severe foul', 2, 0);
END
GO

IF NOT EXISTS (SELECT 1 FROM dbo.PenaltyDefinitions WHERE PenaltyCode = N'ABSENCE')
BEGIN
    INSERT INTO dbo.PenaltyDefinitions (PenaltyCode, PenaltyName, SeverityPoints, RequiresManualReview)
    VALUES (N'ABSENCE', N'Unreported absence', 3, 1);
END
GO

IF NOT EXISTS (
    SELECT 1
    FROM dbo.PenaltyEvents
    WHERE MatchId = 1001
      AND PlayerId = 10
      AND PenaltyCode = N'YELLOW'
      AND SourceSystem = N'referee'
      AND OccurredAt = '2026-03-15T17:18:00'
)
BEGIN
    INSERT INTO dbo.PenaltyEvents (MatchId, PlayerId, PenaltyCode, SourceSystem, OccurredAt, IsResolved, ReviewedBy)
    VALUES (1001, 10, N'YELLOW', N'referee', '2026-03-15T17:18:00', 1, N'audit.bot');
END
GO

IF NOT EXISTS (
    SELECT 1
    FROM dbo.PenaltyEvents
    WHERE MatchId = 1001
      AND PlayerId = 20
      AND PenaltyCode = N'RED'
      AND SourceSystem = N'referee'
      AND OccurredAt = '2026-03-15T18:04:00'
)
BEGIN
    INSERT INTO dbo.PenaltyEvents (MatchId, PlayerId, PenaltyCode, SourceSystem, OccurredAt, IsResolved, ReviewedBy)
    VALUES (1001, 20, N'RED', N'referee', '2026-03-15T18:04:00', 0, NULL);
END
GO

IF NOT EXISTS (
    SELECT 1
    FROM dbo.PenaltyEvents
    WHERE MatchId = 1002
      AND PlayerId = 21
      AND PenaltyCode = N'FOUL'
      AND SourceSystem = N'video-review'
      AND OccurredAt = '2026-03-19T19:44:00'
)
BEGIN
    INSERT INTO dbo.PenaltyEvents (MatchId, PlayerId, PenaltyCode, SourceSystem, OccurredAt, IsResolved, ReviewedBy)
    VALUES (1002, 21, N'FOUL', N'video-review', '2026-03-19T19:44:00', 1, N'security.bot');
END
GO

IF NOT EXISTS (
    SELECT 1
    FROM dbo.PenaltyEvents
    WHERE MatchId = 1002
      AND PlayerId = 30
      AND PenaltyCode = N'ABSENCE'
      AND SourceSystem = N'manual'
      AND OccurredAt = '2026-03-19T20:10:00'
)
BEGIN
    INSERT INTO dbo.PenaltyEvents (MatchId, PlayerId, PenaltyCode, SourceSystem, OccurredAt, IsResolved, ReviewedBy)
    VALUES (1002, 30, N'ABSENCE', N'manual', '2026-03-19T20:10:00', 0, NULL);
END
GO

IF NOT EXISTS (
    SELECT 1
    FROM dbo.PenaltyEvents
    WHERE MatchId = 1003
      AND PlayerId = 11
      AND PenaltyCode = N'YELLOW'
      AND SourceSystem = N'referee'
      AND OccurredAt = '2026-03-24T20:21:00'
)
BEGIN
    INSERT INTO dbo.PenaltyEvents (MatchId, PlayerId, PenaltyCode, SourceSystem, OccurredAt, IsResolved, ReviewedBy)
    VALUES (1003, 11, N'YELLOW', N'referee', '2026-03-24T20:21:00', 0, NULL);
END
GO

IF NOT EXISTS (SELECT 1 FROM security.PlayerPermissions WHERE PlayerId = 10)
BEGIN
    INSERT INTO security.PlayerPermissions (PlayerId, CanViewSensitiveData, CanCloseCase, LastReviewedAt)
    VALUES (10, 1, 1, '2026-03-20T08:00:00');
END
GO

IF NOT EXISTS (SELECT 1 FROM security.PlayerPermissions WHERE PlayerId = 11)
BEGIN
    INSERT INTO security.PlayerPermissions (PlayerId, CanViewSensitiveData, CanCloseCase, LastReviewedAt)
    VALUES (11, 1, 0, '2026-03-20T08:00:00');
END
GO

IF NOT EXISTS (SELECT 1 FROM security.PlayerPermissions WHERE PlayerId = 20)
BEGIN
    INSERT INTO security.PlayerPermissions (PlayerId, CanViewSensitiveData, CanCloseCase, LastReviewedAt)
    VALUES (20, 0, 1, '2026-03-20T08:10:00');
END
GO

IF NOT EXISTS (SELECT 1 FROM security.PlayerPermissions WHERE PlayerId = 21)
BEGIN
    INSERT INTO security.PlayerPermissions (PlayerId, CanViewSensitiveData, CanCloseCase, LastReviewedAt)
    VALUES (21, 1, 0, '2026-03-20T08:15:00');
END
GO

IF NOT EXISTS (SELECT 1 FROM security.PlayerPermissions WHERE PlayerId = 30)
BEGIN
    INSERT INTO security.PlayerPermissions (PlayerId, CanViewSensitiveData, CanCloseCase, LastReviewedAt)
    VALUES (30, 0, 0, '2026-03-20T08:20:00');
END
GO

IF NOT EXISTS (SELECT 1 FROM staging.PenaltyIncoming WHERE ExternalEventRef = N'feed-2026-03-31-001')
BEGIN
    INSERT INTO staging.PenaltyIncoming (ExternalEventRef, PlayerId, PenaltyCode, MatchId, ImportedAt, Processed)
    VALUES (N'feed-2026-03-31-001', 20, N'YELLOW', 1003, '2026-03-31T06:40:00', 0);
END
GO

IF NOT EXISTS (SELECT 1 FROM staging.PenaltyIncoming WHERE ExternalEventRef = N'feed-2026-03-31-002')
BEGIN
    INSERT INTO staging.PenaltyIncoming (ExternalEventRef, PlayerId, PenaltyCode, MatchId, ImportedAt, Processed)
    VALUES (N'feed-2026-03-31-002', 30, N'RED', 1003, '2026-03-31T06:45:00', 0);
END
GO

IF NOT EXISTS (
    SELECT 1
    FROM audit.PenaltyAudit AS auditRows
    INNER JOIN dbo.PenaltyEvents AS events ON events.EventId = auditRows.EventId
    WHERE events.MatchId = 1001
      AND events.PlayerId = 10
      AND auditRows.AuditAction = N'initial-review'
)
BEGIN
    INSERT INTO audit.PenaltyAudit (EventId, AuditAction, CheckedAt, CheckedBy)
    SELECT TOP (1)
        events.EventId,
        N'initial-review',
        '2026-03-15T17:30:00',
        N'audit.bot'
    FROM dbo.PenaltyEvents AS events
    WHERE events.MatchId = 1001
      AND events.PlayerId = 10
    ORDER BY events.EventId DESC;
END
GO

IF NOT EXISTS (
    SELECT 1
    FROM audit.PenaltyAudit AS auditRows
    INNER JOIN dbo.PenaltyEvents AS events ON events.EventId = auditRows.EventId
    WHERE events.MatchId = 1002
      AND events.PlayerId = 21
      AND auditRows.AuditAction = N'resolution-check'
)
BEGIN
    INSERT INTO audit.PenaltyAudit (EventId, AuditAction, CheckedAt, CheckedBy)
    SELECT TOP (1)
        events.EventId,
        N'resolution-check',
        '2026-03-19T20:00:00',
        N'security.bot'
    FROM dbo.PenaltyEvents AS events
    WHERE events.MatchId = 1002
      AND events.PlayerId = 21
    ORDER BY events.EventId DESC;
END
GO

CREATE OR ALTER FUNCTION reporting.ufn_PenaltyPoints (@PenaltyCode nvarchar(20))
RETURNS int
AS
BEGIN
    DECLARE @points int;

    SELECT @points = definitions.SeverityPoints
    FROM dbo.PenaltyDefinitions AS definitions
    WHERE definitions.PenaltyCode = @PenaltyCode;

    RETURN ISNULL(@points, 0);
END
GO

CREATE OR ALTER FUNCTION security.ufn_HasPlayerAccess (@PlayerId int)
RETURNS bit
AS
BEGIN
    DECLARE @hasAccess bit = 0;

    SELECT TOP (1)
        @hasAccess = CAST(CASE WHEN permissions.CanViewSensitiveData = 1 OR permissions.CanCloseCase = 1 THEN 1 ELSE 0 END AS bit)
    FROM security.PlayerPermissions AS permissions
    WHERE permissions.PlayerId = @PlayerId
    ORDER BY permissions.PermissionId DESC;

    RETURN ISNULL(@hasAccess, 0);
END
GO

CREATE OR ALTER FUNCTION reporting.ufn_PlayerRiskBand (@PlayerId int)
RETURNS nvarchar(20)
AS
BEGIN
    DECLARE @totalPoints int;

    SELECT @totalPoints = ISNULL(SUM(definitions.SeverityPoints), 0)
    FROM dbo.PenaltyEvents AS events
    INNER JOIN dbo.PenaltyDefinitions AS definitions ON definitions.PenaltyCode = events.PenaltyCode
    WHERE events.PlayerId = @PlayerId;

    RETURN CASE
        WHEN ISNULL(@totalPoints, 0) >= 8 THEN N'critical'
        WHEN ISNULL(@totalPoints, 0) >= 4 THEN N'watchlist'
        ELSE N'normal'
    END;
END
GO

CREATE OR ALTER VIEW security.vw_PenaltyEvents
AS
SELECT
    events.EventId,
    events.MatchId,
    players.PlayerId,
    players.PlayerName,
    teams.TeamCode,
    events.PenaltyCode,
    definitions.SeverityPoints,
    events.SourceSystem,
    events.OccurredAt,
    events.IsResolved,
    events.ReviewedBy
FROM dbo.PenaltyEvents AS events
INNER JOIN dbo.Players AS players ON players.PlayerId = events.PlayerId
INNER JOIN dbo.Teams AS teams ON teams.TeamId = players.TeamId
INNER JOIN dbo.PenaltyDefinitions AS definitions ON definitions.PenaltyCode = events.PenaltyCode;
GO

CREATE OR ALTER VIEW reporting.vw_PlayerPenaltyTotals
AS
SELECT
    events.PlayerId,
    players.PlayerName,
    COUNT(*) AS PenaltyCount,
    SUM(definitions.SeverityPoints) AS TotalPoints
FROM dbo.PenaltyEvents AS events
INNER JOIN dbo.Players AS players ON players.PlayerId = events.PlayerId
INNER JOIN dbo.PenaltyDefinitions AS definitions ON definitions.PenaltyCode = events.PenaltyCode
GROUP BY
    events.PlayerId,
    players.PlayerName;
GO

CREATE OR ALTER VIEW audit.vw_PenaltyReviewCandidates
AS
SELECT
    events.EventId,
    players.PlayerName,
    events.PenaltyCode,
    reporting.ufn_PenaltyPoints(events.PenaltyCode) AS CalculatedPoints,
    security.ufn_HasPlayerAccess(events.PlayerId) AS HasAccess,
    definitions.RequiresManualReview
FROM dbo.PenaltyEvents AS events
INNER JOIN dbo.Players AS players ON players.PlayerId = events.PlayerId
INNER JOIN dbo.PenaltyDefinitions AS definitions ON definitions.PenaltyCode = events.PenaltyCode
WHERE events.IsResolved = 0
   OR definitions.RequiresManualReview = 1;
GO

CREATE OR ALTER VIEW reporting.vw_OpenPenaltyCases
AS
SELECT
    events.EventId,
    players.PlayerName,
    events.PenaltyCode,
    reporting.ufn_PlayerRiskBand(events.PlayerId) AS RiskBand,
    events.SourceSystem
FROM dbo.PenaltyEvents AS events
INNER JOIN dbo.Players AS players ON players.PlayerId = events.PlayerId
WHERE events.IsResolved = 0;
GO

IF OBJECT_ID(N'reporting.syn_LivePenaltyEvents', N'SN') IS NOT NULL
BEGIN
    DROP SYNONYM reporting.syn_LivePenaltyEvents;
END
GO

CREATE SYNONYM reporting.syn_LivePenaltyEvents FOR dbo.PenaltyEvents;
GO

CREATE OR ALTER PROCEDURE audit.usp_LoadPenaltyData
AS
BEGIN
    SET NOCOUNT ON;

    SELECT TOP (20) *
    FROM security.vw_PenaltyEvents
    ORDER BY OccurredAt DESC;

    SELECT COUNT(*) AS AuditRows
    FROM audit.PenaltyAudit;

    SELECT COUNT(*) AS SynonymRows
    FROM reporting.syn_LivePenaltyEvents;
END
GO

CREATE OR ALTER PROCEDURE security.usp_CheckPermissions
AS
BEGIN
    SET NOCOUNT ON;

    SELECT
        players.PlayerId,
        players.PlayerName,
        permissions.CanCloseCase,
        security.ufn_HasPlayerAccess(players.PlayerId) AS HasAccess
    FROM dbo.Players AS players
    LEFT JOIN security.PlayerPermissions AS permissions ON permissions.PlayerId = players.PlayerId
    WHERE players.IsActive = 1;
END
GO

CREATE OR ALTER PROCEDURE audit.usp_InsertPenaltyAudit
    @EventId int,
    @AuditAction nvarchar(60),
    @CheckedBy sysname = N'system'
AS
BEGIN
    SET NOCOUNT ON;

    INSERT INTO audit.PenaltyAudit (EventId, AuditAction, CheckedBy)
    SELECT
        @EventId,
        @AuditAction,
        @CheckedBy
    WHERE EXISTS (
        SELECT 1
        FROM dbo.PenaltyEvents AS events
        WHERE events.EventId = @EventId
    );
END
GO

CREATE OR ALTER PROCEDURE reporting.usp_BuildPenaltyDashboard
AS
BEGIN
    SET NOCOUNT ON;

    EXEC audit.usp_LoadPenaltyData;

    DELETE FROM reporting.PenaltyDashboardCache
    WHERE SnapshotLabel = N'latest';

    INSERT INTO reporting.PenaltyDashboardCache (SnapshotLabel, PlayerId, PenaltyTotal, RiskBand)
    SELECT
        N'latest',
        totals.PlayerId,
        totals.TotalPoints,
        reporting.ufn_PlayerRiskBand(totals.PlayerId)
    FROM reporting.vw_PlayerPenaltyTotals AS totals;

    SELECT
        totals.PlayerName,
        totals.TotalPoints,
        benchmarks.EscalationBand,
        reporting.ufn_PlayerRiskBand(totals.PlayerId) AS RiskBand
    FROM reporting.vw_PlayerPenaltyTotals AS totals
    LEFT JOIN [AnalyticsDb].dbo.PenaltyBenchmarks AS benchmarks ON benchmarks.PenaltyCode = N'RED'
    ORDER BY totals.TotalPoints DESC;
END
GO

CREATE OR ALTER PROCEDURE audit.usp_QueueManualReview
AS
BEGIN
    SET NOCOUNT ON;

    -- Intentional unresolved dependency for the dependency graph demo.
    SELECT COUNT(*) AS PendingManualReviews
    FROM security.ManualReviewBacklog;
END
GO

CREATE OR ALTER PROCEDURE integration.usp_ImportExternalPenalties
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @latestImportedEventId int;

    INSERT INTO integration.PenaltyImportBatch (SourceSystem, ImportedRows)
    SELECT
        N'partner-feed',
        COUNT(*)
    FROM staging.PenaltyIncoming AS incoming
    WHERE incoming.Processed = 0;

    INSERT INTO dbo.PenaltyEvents (MatchId, PlayerId, PenaltyCode, SourceSystem, OccurredAt, IsResolved, ReviewedBy)
    SELECT
        incoming.MatchId,
        incoming.PlayerId,
        incoming.PenaltyCode,
        N'partner-feed',
        DATEADD(minute, -5, incoming.ImportedAt),
        0,
        NULL
    FROM staging.PenaltyIncoming AS incoming
    WHERE incoming.Processed = 0
      AND EXISTS (SELECT 1 FROM dbo.Players AS players WHERE players.PlayerId = incoming.PlayerId)
      AND EXISTS (SELECT 1 FROM dbo.PenaltyDefinitions AS definitions WHERE definitions.PenaltyCode = incoming.PenaltyCode);

    SELECT TOP (1)
        @latestImportedEventId = events.EventId
    FROM dbo.PenaltyEvents AS events
    WHERE events.SourceSystem = N'partner-feed'
    ORDER BY events.EventId DESC;

    IF @latestImportedEventId IS NOT NULL
    BEGIN
        EXEC audit.usp_InsertPenaltyAudit
            @EventId = @latestImportedEventId,
            @AuditAction = N'imported-from-staging',
            @CheckedBy = N'integration.bot';
    END

    UPDATE staging.PenaltyIncoming
    SET Processed = 1
    WHERE Processed = 0;
END
GO

CREATE OR ALTER PROCEDURE archive.usp_ArchiveResolvedPenalties
AS
BEGIN
    SET NOCOUNT ON;

    INSERT INTO archive.PenaltyEventArchive (EventId, PlayerId, PenaltyCode, ArchiveReason)
    SELECT
        events.EventId,
        events.PlayerId,
        events.PenaltyCode,
        N'nightly-archive'
    FROM reporting.syn_LivePenaltyEvents AS events
    WHERE events.IsResolved = 1
      AND NOT EXISTS (
          SELECT 1
          FROM archive.PenaltyEventArchive AS archived
          WHERE archived.EventId = events.EventId
      );
END
GO

CREATE OR ALTER PROCEDURE dbo.usp_PenaltySummary
AS
BEGIN
    SET NOCOUNT ON;

    EXEC audit.usp_LoadPenaltyData;
    EXEC security.usp_CheckPermissions;

    SELECT *
    FROM reporting.vw_PlayerPenaltyTotals
    ORDER BY TotalPoints DESC, PlayerName ASC;
END
GO

CREATE OR ALTER PROCEDURE dbo.usp_PenaltyDrilldown
AS
BEGIN
    SET NOCOUNT ON;

    EXEC reporting.usp_BuildPenaltyDashboard;
    EXEC audit.usp_QueueManualReview;

    SELECT *
    FROM audit.vw_PenaltyReviewCandidates
    ORDER BY EventId DESC;

    SELECT
        players.PlayerId,
        players.PlayerName,
        reporting.ufn_PlayerRiskBand(players.PlayerId) AS RiskBand
    FROM dbo.Players AS players
    ORDER BY players.PlayerId;
END
GO

CREATE OR ALTER PROCEDURE dbo.usp_RunNightlyPenaltyPipeline
AS
BEGIN
    SET NOCOUNT ON;

    EXEC integration.usp_ImportExternalPenalties;
    EXEC dbo.usp_PenaltySummary;
    EXEC archive.usp_ArchiveResolvedPenalties;
END
GO

PRINT N'Demo objects for RaportDb are ready.';
PRINT N'Try these procedures in the frontend:';
PRINT N' - dbo.usp_PenaltySummary';
PRINT N' - dbo.usp_PenaltyDrilldown';
PRINT N' - dbo.usp_RunNightlyPenaltyPipeline';
