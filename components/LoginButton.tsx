'use client';

interface Athlete {
  firstname: string;
  lastname: string;
  profile_medium: string;
  sex?: string;
}

interface Props {
  athlete: Athlete | null;
  onLogin: () => void;
  onLogout: () => void;
}

export default function LoginButton({ athlete, onLogin, onLogout }: Props) {
  if (athlete) {
    return (
      <div className="flex items-center gap-1.5 md:gap-2 shrink-0">
        <img
          src={athlete.profile_medium}
          alt="avatar"
          className="w-8 h-8 rounded-full border-2 border-orange-400"
        />
        <span className="hidden sm:block text-sm font-medium text-white">
          {athlete.firstname} {athlete.lastname}
        </span>
        <button
          onClick={onLogout}
          className="text-xs text-gray-300 hover:text-white underline"
        >
          Logout
        </button>
      </div>
    );
  }
  return (
    <button
      onClick={onLogin}
      className="flex items-center gap-2 bg-orange-500 hover:bg-orange-600 text-white font-semibold px-3 py-2 md:px-4 rounded-lg shadow transition shrink-0"
    >
      <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current shrink-0">
        <path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169" />
      </svg>
      <span className="hidden sm:inline">Connect with </span>Strava
    </button>
  );
}
