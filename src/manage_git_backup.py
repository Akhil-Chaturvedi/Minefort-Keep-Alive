import os
import sys
import subprocess
import shutil
import glob
import datetime
from urllib.parse import urlparse, urlunparse, quote_plus

# --- Configuration from Environment Variables ---
# Use os.environ.get and check for empty string before using the value or default

backup_repo_url_env = os.environ.get('BACKUP_REPO_URL') # No default, required
BACKUP_REPO_URL = backup_repo_url_env
print(f"Config: BACKUP_REPO_URL = {'***' if BACKUP_REPO_URL else 'Not Set'}")


github_token_env = os.environ.get('GITHUB_TOKEN') # No default, required for git push
GITHUB_TOKEN = github_token_env
print(f"Config: GITHUB_TOKEN = {'***' if GITHUB_TOKEN else 'Not Set'}")


backup_folder_in_repo_env = os.environ.get('BACKUP_FOLDER_IN_REPO')
BACKUP_FOLDER_IN_REPO = backup_folder_in_repo_env if backup_folder_in_repo_env else 'backups' # Use env var if not empty, otherwise default
print(f"Config: BACKUP_FOLDER_IN_REPO = {BACKUP_FOLDER_IN_REPO}")

# --- Constants ---
TEMP_REPO_DIR = 'temp_backup_repo' # Temporary directory to clone the backup repo into


# --- Validation ---
if not all([BACKUP_REPO_URL, GITHUB_TOKEN]):
    print("Error: BACKUP_REPO_URL and GITHUB_TOKEN environment variables must be set and not empty.")
    sys.exit(1)


# --- GitHub Interaction ---
def setup_git_credentials():
    """Sets up Git credentials for the runner."""
    print("Setting up Git credentials...")
    try:
        subprocess.run(['git', 'config', '--global', 'user.email', 'action@github.com'], check=True)
        subprocess.run(['git', 'config', '--global', 'user.name', 'GitHub Actions'], check=True)
        print("Git user configured.")
    except subprocess.CalledProcessError as e:
        print(f"Error configuring git user: {e.stderr.decode()}")
        sys.exit(1)


def clone_backup_repo(repo_url, token, target_dir):
    """Clones the backup repository using the token."""
    print(f"Cloning backup repository {repo_url} into {target_dir}...")
    # Embed token in the URL for cloning
    try:
        parsed_url = urlparse(repo_url)
        if not parsed_url.hostname:
             raise ValueError("Could not parse hostname from remote URL for token embedding.")

        netloc_with_token = f'oauth2:{quote_plus(token)}@{parsed_url.hostname}'
        if parsed_url.port:
             netloc_with_token += f':{parsed_url.port}'
        repo_url_with_token = urlunparse(parsed_url._replace(netloc=netloc_with_token))
        print(f"Cloning URL: {repo_url_with_token.replace(quote_plus(token), '***')}") # Mask token in logs

    except ValueError as ve:
         print(f"Error embedding token in push URL: {ve}")
         sys.exit(1)
    except Exception as e:
         print(f"An unexpected error occurred during repo URL construction: {e}")
         sys.exit(1)


    try:
        # Increased clone timeout
        subprocess.run(['git', 'clone', repo_url_with_token, target_dir], check=True, timeout=180) # 3 minutes
        print("Repository cloned successfully.")
    except subprocess.CalledProcessError as e:
        print(f"Error cloning repository: {e.stderr.decode()}")
        sys.exit(1)
    except subprocess.TimeoutExpired:
        print("Error: Git clone timed out.")
        sys.exit(1)
    except Exception as e:
        print(f"An unexpected error occurred during git clone: {e}")
        sys.exit(1)


def manage_and_push_backup(repo_dir, downloaded_backup_filepath):
    """Manages the backup file in the repo (removes old, adds new), commits, and pushes."""
    print(f"Changing directory to {repo_dir}")
    original_dir = os.getcwd()
    os.chdir(repo_dir)

    try:
        # Find and delete old backups in the backup folder within the repo
        backup_dir_full_path_in_repo = os.path.join(os.getcwd(), BACKUP_FOLDER_IN_REPO)
        if os.path.exists(backup_dir_full_path_in_repo):
            print(f"Looking for old backups in {backup_dir_full_path_in_repo}")
            # Use glob to find files matching the pattern (assuming consistent naming)
            # Ensure pattern is relative to the git repo root for git rm
            old_backups_pattern = os.path.join(BACKUP_FOLDER_IN_REPO, "server_backup_*.zip").replace('\\', '/')
            old_backups_relative_paths = sorted(glob.glob(old_backups_pattern))

            if old_backups_relative_paths:
                print(f"Found potential old backups (relative paths): {old_backups_relative_paths}")

                # Remove all old backups found
                for old_file_relative_path in old_backups_relative_paths:
                    print(f"Attempting to remove old backup: {old_file_relative_path}")
                    try:
                        # Use git rm to remove the file from the index and working tree
                        # Use --ignore-unmatch in case the file was already removed from index
                        subprocess.run(['git', 'rm', '--cached', '--ignore-unmatch', old_file_relative_path], check=False, capture_output=True)
                        subprocess.run(['git', 'rm', '-f', '--ignore-unmatch', old_file_relative_path], check=False, capture_output=True)
                        print(f"Attempted git rm on {old_file_relative_path}")
                    except subprocess.CalledProcessError as e:
                         print(f"Warning: Error attempting git rm of old backup {old_file_relative_path}: {e.stderr.decode()}")
                         # Log warning but try to continue


        # Add the new downloaded backup file
        os.makedirs(backup_dir_full_path_in_repo, exist_ok=True) # Ensure target directory exists in repo
        new_backup_target_path_in_repo = os.path.join(backup_dir_full_path_in_repo, os.path.basename(downloaded_backup_filepath))

        print(f"Copying new downloaded backup file into repository: {new_backup_target_path_in_repo}")
        shutil.copy2(downloaded_backup_filepath, new_backup_target_path_in_repo) # Use copy2 to preserve metadata if needed
        print(f"Copied downloaded zip to {new_backup_target_path_in_repo}")

        # Add the new backup file to staging
        # Path should be relative to the git repo root
        new_backup_target_path_relative_in_repo = os.path.join(BACKUP_FOLDER_IN_REPO, os.path.basename(downloaded_backup_filepath)).replace('\\', '/')
        print(f"Adding new backup file to git staging: {new_backup_target_path_relative_in_repo}")
        try:
            subprocess.run(['git', 'add', new_backup_target_path_relative_in_repo], check=True)
            print("New backup file added to staging.")
        except subprocess.CalledProcessError as e:
            print(f"Error adding new backup file {new_backup_target_path_relative_in_repo}: {e.stderr.decode()}")
            sys.exit(1)


        # Commit changes
        # Check if there are any staged changes before committing
        status_output = subprocess.run(['git', 'status', '--porcelain'], capture_output=True, text=True, check=True).stdout.strip()
        if status_output:
            # Use basename for the commit message for clarity
            commit_message = f"Automated backup: {os.path.basename(downloaded_backup_filepath)}"
            print(f"Committing with message: '{commit_message}'")
            try:
                subprocess.run(['git', 'commit', '-m', commit_message], check=True)
                print("Changes committed.")
            except subprocess.CalledProcessError as e:
                print(f"Error committing changes: {e.stderr.decode()}")
                sys.exit(1)
        else:
            print("No changes detected by git status. Skipping commit.")


        # Push changes
        print("Pushing changes to remote repository...")
        try:
            # Use the token embedded URL for pushing
            remote_name = subprocess.run(['git', 'remote'], capture_output=True, text=True, check=True).stdout.strip()
            if not remote_name:
                 print("Error: Could not determine git remote name.")
                 sys.exit(1)

            original_remote_url = subprocess.run(['git', 'remote', 'get-url', remote_name], capture_output=True, text=True, check=True).stdout.strip()

            # Reconstruct the push URL with the token using urlparse for robustness
            try:
                parsed_url = urlparse(original_remote_url)
                if not parsed_url.hostname:
                     raise ValueError("Could not parse hostname from remote URL for token embedding.")

                netloc_with_token = f'oauth2:{quote_plus(GITHUB_TOKEN)}@{parsed_url.hostname}'
                if parsed_url.port:
                     netloc_with_token += f':{parsed_url.port}'
                push_url = urlunparse(parsed_url._replace(netloc=netloc_with_token))
                print(f"Using push URL: {push_url.replace(quote_plus(GITHUB_TOKEN), '***')}") # Mask token in logs

            except ValueError as ve:
                 print(f"Error embedding token in push URL: {ve}")
                 sys.exit(1)
            except Exception as e:
                 print(f"An unexpected error occurred during push URL construction: {e}")
                 sys.exit(1)

            # Push the current branch (HEAD) to its upstream
            current_branch = subprocess.run(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], capture_output=True, text=True, check=True).stdout.strip()

            print(f"Pushing from branch {current_branch}...")
            subprocess.run(['git', 'push', push_url, current_branch], check=True, timeout=300) # 5 minutes
            print("Changes pushed successfully.")
        except subprocess.CalledProcessError as e:
            print(f"Error pushing changes: {e.stderr.decode()}")
            sys.exit(1)
        except subprocess.TimeoutExpired:
            print("Error: Git push timed out.")
            sys.exit(1)
        except Exception as e:
             print(f"An unexpected error occurred during git push: {e}")
             sys.exit(1)

    except Exception as e:
         print(f"An unexpected error occurred during git operations: {e}")
         sys.exit(1)
    finally:
        # Change back to the original directory
        os.chdir(original_dir)


# --- Main Execution ---
if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Error: Path to the downloaded backup file was not provided.")
        print("Usage: python manage_git_backup.py <path_to_downloaded_file>")
        sys.exit(1)

    DOWNLOADED_BACKUP_FILE_PATH = sys.argv[1]

    if not os.path.exists(DOWNLOADED_BACKUP_FILE_PATH):
        print(f"Error: Downloaded backup file not found at '{DOWNLOADED_BACKUP_FILE_PATH}'")
        sys.exit(1)

    print(f"Starting Git management process for backup file: {DOWNLOADED_BACKUP_FILE_PATH}")

    # Clean up temp repo dir if it exists from a previous failed run
    if os.path.exists(TEMP_REPO_DIR):
        print(f"Removing existing temporary repository directory: {TEMP_REPO_DIR}")
        shutil.rmtree(TEMP_REPO_DIR)

    try:
        setup_git_credentials()
        clone_backup_repo(BACKUP_REPO_URL, GITHUB_TOKEN, TEMP_REPO_DIR)
        manage_and_push_backup(TEMP_REPO_DIR, DOWNLOADED_BACKUP_FILE_PATH)
        print("Git management process completed successfully.")
    except Exception as e:
        print(f"Overall Git management process failed: {e}")
        sys.exit(1)
    finally:
        # Clean up the temporary repository directory
        if os.path.exists(TEMP_REPO_DIR):
            print(f"Removing existing temporary repository directory: {TEMP_REPO_DIR}")
            shutil.rmtree(TEMP_REPO_DIR)
        # Clean up the downloaded file after processing
        if os.path.exists(DOWNLOADED_BACKUP_FILE_PATH):
             print(f"Cleaning up downloaded backup file: {DOWNLOADED_BACKUP_FILE_PATH}")
             os.remove(DOWNLOADED_BACKUP_FILE_PATH)
