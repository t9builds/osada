CREATE TABLE "buildings" (
	"id" serial PRIMARY KEY NOT NULL,
	"season_id" integer NOT NULL,
	"kind" text NOT NULL,
	"location" text NOT NULL,
	"team_id" integer NOT NULL,
	"player_id" text,
	"built_at" timestamp with time zone NOT NULL,
	CONSTRAINT "buildings_seasonId_location_unique" UNIQUE("season_id","location")
);
--> statement-breakpoint
CREATE TABLE "inventories" (
	"season_id" integer NOT NULL,
	"player_id" text NOT NULL,
	"resource" text NOT NULL,
	"quantity" integer NOT NULL,
	CONSTRAINT "inventories_season_id_player_id_resource_pk" PRIMARY KEY("season_id","player_id","resource"),
	CONSTRAINT "quantity_non_negative" CHECK ("inventories"."quantity" >= 0)
);
--> statement-breakpoint
CREATE TABLE "ledger" (
	"id" serial PRIMARY KEY NOT NULL,
	"season_id" integer NOT NULL,
	"player_id" text NOT NULL,
	"resource" text NOT NULL,
	"delta" integer NOT NULL,
	"kind" text NOT NULL,
	"ref" text,
	"note" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "offers" (
	"id" serial PRIMARY KEY NOT NULL,
	"season_id" integer NOT NULL,
	"from_player" text NOT NULL,
	"to_player" text,
	"give" jsonb NOT NULL,
	"want" jsonb NOT NULL,
	"status" text NOT NULL,
	"accepted_by" text,
	"created_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "players" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" integer,
	"opted_out" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seasons" (
	"id" serial PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"seed" integer NOT NULL,
	"weeks" integer NOT NULL,
	"week_key" text NOT NULL,
	"week_number" integer NOT NULL,
	"size" text NOT NULL,
	"tiles" jsonb NOT NULL,
	"board_version" integer DEFAULT 0 NOT NULL,
	"longest_road_team_id" integer,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"result" jsonb
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" integer PRIMARY KEY NOT NULL,
	"config" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"color" text NOT NULL,
	"resource" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "teams_name_unique" UNIQUE("name"),
	CONSTRAINT "teams_resource_unique" UNIQUE("resource")
);
--> statement-breakpoint
CREATE TABLE "thanks" (
	"id" serial PRIMARY KEY NOT NULL,
	"season_id" integer NOT NULL,
	"week_key" text NOT NULL,
	"from_player" text NOT NULL,
	"to_player" text NOT NULL,
	"from_team_id" integer NOT NULL,
	"to_team_id" integer,
	"resource" text NOT NULL,
	"reason" text NOT NULL,
	"source_ref" text,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "thanks_seasonId_weekKey_fromPlayer_toPlayer_unique" UNIQUE("season_id","week_key","from_player","to_player")
);
--> statement-breakpoint
ALTER TABLE "buildings" ADD CONSTRAINT "buildings_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buildings" ADD CONSTRAINT "buildings_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buildings" ADD CONSTRAINT "buildings_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventories" ADD CONSTRAINT "inventories_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventories" ADD CONSTRAINT "inventories_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger" ADD CONSTRAINT "ledger_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger" ADD CONSTRAINT "ledger_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_from_player_players_id_fk" FOREIGN KEY ("from_player") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_to_player_players_id_fk" FOREIGN KEY ("to_player") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thanks" ADD CONSTRAINT "thanks_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thanks" ADD CONSTRAINT "thanks_from_player_players_id_fk" FOREIGN KEY ("from_player") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thanks" ADD CONSTRAINT "thanks_to_player_players_id_fk" FOREIGN KEY ("to_player") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ledger_player_id_index" ON "ledger" USING btree ("player_id");--> statement-breakpoint
CREATE UNIQUE INDEX "one_active_season" ON "seasons" USING btree ("status") WHERE "seasons"."status" = 'active';--> statement-breakpoint
CREATE INDEX "thanks_to_player_index" ON "thanks" USING btree ("to_player");