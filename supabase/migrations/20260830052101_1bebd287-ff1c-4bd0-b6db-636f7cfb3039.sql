ALTER TABLE public.profiles
  ADD COLUMN handle text;

ALTER TABLE public.businesses
  ADD COLUMN handle text;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_handle_format CHECK (handle IS NULL OR handle ~ '^[a-z0-9][a-z0-9-]{1,39}$');

ALTER TABLE public.businesses
  ADD CONSTRAINT businesses_handle_format CHECK (handle IS NULL OR handle ~ '^[a-z0-9][a-z0-9-]{1,39}$');

CREATE UNIQUE INDEX profiles_handle_unique ON public.profiles (handle) WHERE handle IS NOT NULL;
CREATE UNIQUE INDEX businesses_handle_unique ON public.businesses (handle) WHERE handle IS NOT NULL;