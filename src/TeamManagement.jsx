import React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';

export default function TeamManagement({ employees, setEmployees, taskTemplates }) {
  const handleAddEmployee = () => {
    const newEmp = {
      id: uuidv4(),
      name: 'New Employee',
      skills: {}
    };
    setEmployees([...employees, newEmp]);
  };

  const handleDeleteEmployee = (id) => {
    setEmployees(employees.filter(e => e.id !== id));
  };

  const handleNameChange = (id, newName) => {
    setEmployees(employees.map(e => e.id === id ? { ...e, name: newName } : e));
  };

  const handleSkillChange = (empId, taskId, newLevel) => {
    setEmployees(employees.map(e => {
      if (e.id === empId) {
        return {
          ...e,
          skills: {
            ...e.skills,
            [taskId]: newLevel
          }
        };
      }
      return e;
    }));
  };

  return (
    <div className="team-management" style={{ padding: '2rem', flex: 1, overflowY: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <h2>Team Management</h2>
        <button className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }} onClick={handleAddEmployee}>
          <Plus size={16} /> Add Employee
        </button>
      </div>

      <div className="employee-list" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        {employees.map(emp => (
          <div key={emp.id} className="card" style={{ padding: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '1rem' }}>
              <input
                type="text"
                value={emp.name}
                onChange={(e) => handleNameChange(emp.id, e.target.value)}
                style={{
                  fontSize: '1.25rem',
                  fontWeight: 600,
                  border: 'none',
                  background: 'transparent',
                  outline: 'none',
                  borderBottom: '2px solid transparent',
                  padding: '4px',
                  width: '300px'
                }}
                onFocus={(e) => e.target.style.borderBottom = '2px solid var(--primary)'}
                onBlur={(e) => e.target.style.borderBottom = '2px solid transparent'}
              />
              <button 
                className="btn btn-icon" 
                style={{ color: 'var(--danger)' }} 
                onClick={() => handleDeleteEmployee(emp.id)}
                title="Delete Employee"
              >
                <Trash2 size={18} />
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '1rem' }}>
              {taskTemplates.map(task => (
                <div key={task.id} style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <label style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--text-main)' }}>
                    {task.name}
                  </label>
                  <select 
                    value={emp.skills[task.id] || 'untrained'} 
                    onChange={(e) => handleSkillChange(emp.id, task.id, e.target.value)}
                    style={{
                      padding: '0.5rem',
                      borderRadius: 'var(--radius-md)',
                      border: '1px solid var(--border-color)',
                      backgroundColor: 'var(--bg-base)',
                      fontSize: '0.875rem'
                    }}
                  >
                    <option value="untrained">Untrained</option>
                    <option value="beginner">Beginner</option>
                    <option value="expert">Expert</option>
                  </select>
                </div>
              ))}
            </div>
          </div>
        ))}

        {employees.length === 0 && (
          <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
            No employees on your team yet.
          </div>
        )}
      </div>
    </div>
  );
}
