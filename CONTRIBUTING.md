# Contributing to GitHub RunnerHub

First off, thank you for considering contributing to GitHub RunnerHub! It's people like you that make GitHub RunnerHub such a great tool.

## Code of Conduct

This project and everyone participating in it is governed by our Code of Conduct. By participating, you are expected to uphold this code.

## How Can I Contribute?

### Reporting Bugs

Before creating bug reports, please check existing issues as you might find out that you don't need to create one. When you are creating a bug report, please include as many details as possible:

* Use a clear and descriptive title
* Describe the exact steps which reproduce the problem
* Provide specific examples to demonstrate the steps
* Describe the behavior you observed after following the steps
* Explain which behavior you expected to see instead and why
* Include logs and error messages

### Suggesting Enhancements

Enhancement suggestions are tracked as GitHub issues. When creating an enhancement suggestion, please include:

* Use a clear and descriptive title
* Provide a step-by-step description of the suggested enhancement
* Provide specific examples to demonstrate the steps
* Describe the current behavior and explain which behavior you expected to see instead
* Explain why this enhancement would be useful

### Pull Requests

* Fill in the required template
* Do not include issue numbers in the PR title
* Follow the TypeScript styleguide
* Include thoughtfully-worded, well-structured tests
* Document new code
* End all files with a newline

## Development Process

1. Fork the repo and create your branch from `main`
2. If you've added code that should be tested, add tests
3. If you've changed APIs, update the documentation
4. Ensure the test suite passes
5. Make sure your code lints
6. Issue that pull request!

### Local Development

```bash
# Clone your fork
git clone https://github.com/your-username/GitHub-RunnerHub.git
cd GitHub-RunnerHub

# Install dependencies
npm install

# Create a branch
git checkout -b my-feature-branch

# Start development
npm run dev

# Run tests
npm test

# Build the project
npm run build

# Run linting
npm run lint
```

### Testing

* Write tests for any new functionality
* Ensure all tests pass before submitting PR
* Include both unit and integration tests where appropriate
* Test files should be colocated with the code they test

### Code Style

* Use TypeScript for all new code
* Follow the existing code style
* Use meaningful variable and function names
* Comment complex logic
* Keep functions small and focused
* Use async/await over promises where possible

### Commit Messages

* Use the present tense ("Add feature" not "Added feature")
* Use the imperative mood ("Move cursor to..." not "Moves cursor to...")
* Limit the first line to 72 characters or less
* Reference issues and pull requests liberally after the first line

### Documentation

* Update the README.md with details of changes to the interface
* Update the API documentation for any API changes
* Comment your code where necessary
* Update type definitions

## Project Structure

```
src/
├── controllers/    # Request handlers
├── services/       # Business logic
├── middleware/     # Express middleware
├── routes/         # API routes
├── types/          # TypeScript types
└── utils/          # Helper functions
```

## Additional Notes

### Issue and Pull Request Labels

* `bug` - Something isn't working
* `enhancement` - New feature or request
* `documentation` - Improvements or additions to documentation
* `good first issue` - Good for newcomers
* `help wanted` - Extra attention is needed

## Recognition

Contributors will be recognized in our README.md file. Thank you for your contributions!

## Questions?

Feel free to open an issue with your question or reach out through GitHub discussions.